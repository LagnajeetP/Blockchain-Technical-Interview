import { env } from 'cloudflare:workers';
import { keccak256, stringToHex, type Hash } from 'viem';
import {
  chooseRoute,
  createEvaluation,
  DEMO_SEED,
  selectEvidence,
  validateReport,
  type Goal,
} from '@/lib/evidence';
import {
  assertListingBinding,
  assertLiveConfiguration,
  broadcastPrepared,
  chainActors,
  confirmEvent,
  liveChainConfigured,
  liveChainEnabled,
  prepareAccept,
  prepareBuy,
  prepareDelivery,
  prepareReject,
  prepareWithdraw,
  publicChainInfo,
  requestIdFor,
  type EscrowEventName,
  type PreparedTransaction,
} from '@/lib/server/chain';
import {
  ensureDemoCatalog,
  FAULT_LISTING_ID,
  PRIOR_LISTING_ID,
  readEnvelope,
  termsHashForReport,
  toPublicListing,
} from '@/lib/server/catalog';
import {
  commitmentOf,
  randomToken,
  sha256,
  type StoredEnvelope,
} from '@/lib/server/crypto';
import {
  claimRun,
  claimLiveRunLease,
  getListing,
  getRun,
  getTransactionIntent,
  insertRun,
  insertTransactionIntent,
  recordEventReceipt,
  releaseRun,
  RunLockLostError,
  updateRun,
  updateTransactionIntent,
  type StoredRun,
} from '@/lib/server/db';
import type {
  ListingRecord,
  PublicRun,
  RunRecord,
  RunResult,
  RunStage,
  Scenario,
} from '@/lib/server/types';

const RUN_TTL_MS = 30 * 60_000;
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60_000;
const DEFAULT_BUDGET_WEI = 2_000_000_000_000n;
const ABSOLUTE_MAX_EVIDENCE_SPEND_WEI = 10_000_000_000_000n;

export class RunBusyError extends Error {}
export class PendingConfirmationError extends Error {}
export class RunUnavailableError extends Error {}

function assertPublicRunAccess(run?: RunRecord): void {
  const liveConfigured = liveChainConfigured();
  const liveEnabled = liveChainEnabled();
  if (liveConfigured && !liveEnabled) {
    throw new RunUnavailableError(
      'The evidence market is unavailable while the live catalog is being prepared',
    );
  }
  const activeMode = liveEnabled ? 'live' : 'simulation';
  if (run && run.chainMode !== activeMode) {
    throw new RunUnavailableError(
      'This run belongs to a marketplace mode that is no longer active',
    );
  }
}

function assertListingVersion(
  run: RunRecord,
  listing: ListingRecord | null,
): asserts listing is ListingRecord {
  if (!listing) throw new Error('Selected listing is unavailable');
  if (
    !run.selectedListingCommitment ||
    run.selectedListingCommitment !== listing.commitment
  ) {
    throw new RunUnavailableError(
      'The selected listing version is no longer active; start a new run',
    );
  }
}

function evidenceBudget(): bigint {
  const raw = env.LIVE_RUN_BUDGET_WEI || DEFAULT_BUDGET_WEI.toString();
  if (!/^\d+$/.test(raw))
    throw new Error('LIVE_RUN_BUDGET_WEI must be a positive integer');
  const value = BigInt(raw);
  if (value <= 0n || value > ABSOLUTE_MAX_EVIDENCE_SPEND_WEI) {
    throw new Error(
      `Evidence spend cap must be between 1 and ${ABSOLUTE_MAX_EVIDENCE_SPEND_WEI} wei`,
    );
  }
  return value;
}

function now() {
  return Date.now();
}

function addTrace(
  run: RunRecord,
  stage: RunStage | 'created',
  label: string,
  detail: string,
  txHash?: Hash,
) {
  const at = now();
  run.trace.push({
    stage,
    label,
    detail,
    at,
    elapsedMs: at - run.createdAt,
    txHash,
  });
  run.updatedAt = at;
}

function publicRun(run: RunRecord, listing: ListingRecord | null): PublicRun {
  return { ...run, listing: listing ? toPublicListing(listing) : null };
}

async function loadArtifact(listing: ListingRecord) {
  const serialized = await readEnvelope(listing);
  let envelope: StoredEnvelope | null = null;
  try {
    envelope = JSON.parse(serialized) as StoredEnvelope;
  } catch {
    // The validation object below reports malformed JSON without exposing it.
  }
  const integrity = commitmentOf(serialized) === listing.commitment;
  const report = envelope?.report;
  const provenance =
    envelope?.schemaVersion === 'evalvault-report-v1' &&
    listing.provenance ===
      'EvalVault operator · private deterministic evaluator';
  const terms = Boolean(
    report &&
    report.candidateId === listing.candidateId &&
    report.suiteVersion === listing.suiteVersion &&
    report.sampleCount === listing.sampleCount &&
    termsHashForReport(report, listing.sampleCount) === listing.termsHash,
  );
  const reportValidation = report
    ? validateReport(report, report.evaluationSeed)
    : {
        valid: false,
        errors: ['artifact is not a valid report envelope'],
        metrics: { accuracy: 0, p50Ms: 0, p95Ms: 0 },
      };
  const errors = [
    ...(integrity ? [] : ['artifact commitment mismatch']),
    ...(provenance ? [] : ['provenance envelope mismatch']),
    ...(terms ? [] : ['report does not match purchased listing terms']),
    ...reportValidation.errors,
  ];
  return {
    serialized,
    report,
    validation: {
      valid: errors.length === 0,
      errors,
      checks: {
        integrity,
        provenance,
        terms,
        recomputed: reportValidation.valid,
      },
    },
  };
}

function priorReport() {
  return createEvaluation(DEMO_SEED, 'fast-keyword');
}

function startingResult(
  goal: Goal,
  selectionMode: RunResult['selectionMode'] = 'policy',
): RunResult {
  const route = chooseRoute([priorReport()], goal);
  return {
    selectionMode,
    beforeDecision: route.reason,
    afterDecision: 'Pending purchased evidence.',
    route,
  };
}

function validateInput(value: unknown): {
  goal: Goal;
  scenario: Scenario;
  listingId: string | null;
} {
  const body = value as {
    goal?: unknown;
    scenario?: unknown;
    listingId?: unknown;
  };
  if (!body || !['speed', 'balanced', 'quality'].includes(String(body.goal))) {
    throw new Error('goal must be speed, balanced, or quality');
  }
  if (!['success', 'refund', 'market'].includes(String(body.scenario))) {
    throw new Error('scenario must be success, refund, or market');
  }
  const listingId =
    typeof body.listingId === 'string' && body.listingId.length <= 96
      ? body.listingId
      : null;
  if (body.scenario === 'market' && !listingId)
    throw new Error('listingId is required for an interactive purchase');
  if (body.scenario !== 'market' && body.listingId !== undefined)
    throw new Error('listingId is only accepted for an interactive purchase');
  return {
    goal: body.goal as Goal,
    scenario: body.scenario as Scenario,
    listingId,
  };
}

export async function createRun(value: unknown) {
  const { goal, scenario, listingId } = validateInput(value);
  assertPublicRunAccess();
  const listings = await ensureDemoCatalog();
  const chainMode = liveChainEnabled()
    ? ('live' as const)
    : ('simulation' as const);
  const budgetWei = evidenceBudget();
  const runId = crypto.randomUUID();

  if (chainMode === 'live') await assertLiveConfiguration();

  const market = listings.filter((listing) => listing.id !== FAULT_LISTING_ID);
  const selection = selectEvidence(
    market,
    {
      goal,
      budgetWei,
      maxAgeMs: MAX_EVIDENCE_AGE_MS,
      purchasedIds: [PRIOR_LISTING_ID],
    },
    now(),
  );
  let chosen: ListingRecord | null;
  if (scenario === 'market') {
    const requested = listings.find((listing) => listing.id === listingId);
    if (!requested) throw new Error('Selected listing is unavailable');
    if (requested.sampleCount < 24)
      throw new Error('Selected listing does not meet the minimum coverage');
    const manualSelection = selectEvidence(
      [requested],
      {
        goal,
        budgetWei,
        maxAgeMs: MAX_EVIDENCE_AGE_MS,
        purchasedIds: [PRIOR_LISTING_ID],
      },
      now(),
    );
    if (!manualSelection.chosen) {
      throw new Error(
        `Selected listing rejected: ${manualSelection.decisions[0]?.reason ?? 'buyer policy failed'}`,
      );
    }
    chosen = requested;
  } else {
    chosen =
      scenario === 'refund'
        ? (listings.find((listing) => listing.id === FAULT_LISTING_ID) ?? null)
        : (selection.chosen as ListingRecord | null);
  }
  if (!chosen) throw new Error('No eligible evidence listing is available');
  if (chosen.priceWei > budgetWei)
    throw new Error('Selected listing exceeds the enforced spend cap');
  if (chainMode === 'live' && !chosen.contractListingId) {
    throw new Error(
      'Selected listing has not been seeded in the live contract',
    );
  }
  if (chainMode === 'live') {
    await assertListingBinding(
      BigInt(chosen.contractListingId!),
      chosen.commitment as `0x${string}`,
      chosen.termsHash,
      chosen.priceWei,
      BigInt(Math.floor(chosen.expiresAt / 1000)),
    );
    if (!(await claimLiveRunLease(runId))) {
      throw new RunBusyError(
        'One live demo is allowed per minute; retry after the current lease expires',
      );
    }
  }

  const createdAt = now();
  const token = randomToken();
  const run: RunRecord = {
    id: runId,
    scenario,
    goal,
    status: 'running',
    stage: 'selected',
    chainMode,
    selectedListingId: chosen.id,
    selectedListingCommitment: chosen.commitment,
    selectedCandidateId: null,
    decisionReason:
      scenario === 'refund'
        ? 'Guided refund path selected; private contents remain sealed until evaluator inspection.'
        : scenario === 'market'
          ? `Buyer selected ${chosen.id}; server-side policy rechecked ownership, status, freshness, coverage, price, and spend cap.`
          : selection.decisions
              .map((item) => `${item.listingId}: ${item.reason}`)
              .join(' · '),
    contractOrderId: null,
    trace: [],
    txHashes: [],
    result: startingResult(goal, scenario === 'market' ? 'manual' : 'policy'),
    error: null,
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + RUN_TTL_MS,
  };
  addTrace(
    run,
    'created',
    'Evidence gap detected',
    `${run.result?.beforeDecision}. Public metadata selected ${chosen.id}; scores remained sealed.`,
  );
  await insertRun(run, await sha256(token));
  return { run: publicRun(run, chosen), token, chain: publicChainInfo() };
}

function bearer(request: Request): string | null {
  const value = request.headers.get('authorization');
  return value?.startsWith('Bearer ') ? value.slice(7) : null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let index = 0; index < a.length; index += 1)
    different |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return different === 0;
}

export async function authorizedRun(
  id: string,
  request: Request,
): Promise<StoredRun | null> {
  const token = bearer(request);
  const run = await getRun(id);
  if (!token || !run || !safeEqual(await sha256(token), run.tokenHash))
    return null;
  return run;
}

export async function getPublicRun(run: RunRecord) {
  assertPublicRunAccess(run);
  const listing = run.selectedListingId
    ? await getListing(run.selectedListingId)
    : null;
  assertListingVersion(run, listing);
  return {
    run: await hydratedPublicRun(run, listing),
    chain: publicChainInfo(),
  };
}

async function hydratedPublicRun(
  run: RunRecord,
  listing: ListingRecord | null,
): Promise<PublicRun> {
  const copy = structuredClone(run);
  const wasUnlocked = copy.trace.some(
    (entry) => entry.label === 'Evidence unlocked',
  );
  if (listing && wasUnlocked && copy.scenario !== 'refund' && copy.result) {
    const artifact = await loadArtifact(listing);
    if (artifact.report) {
      copy.result = {
        ...copy.result,
        report: artifact.report,
        validation: artifact.validation,
      };
    }
  }
  return publicRun(copy, listing);
}

function pendingHash(run: RunRecord, label: string): Hash | null {
  const item = [...run.trace]
    .reverse()
    .find((entry) => entry.label === `${label} broadcast` && entry.txHash);
  return item?.txHash ?? null;
}

async function liveTransaction(
  run: RunRecord,
  lockOwner: string,
  label: string,
  eventName: EscrowEventName,
  expectedSender: string,
  prepareAction: () => Promise<PreparedTransaction>,
  onConfirmed: (event: Awaited<ReturnType<typeof confirmEvent>>) => void,
) {
  const intentId = `run:${run.id}:${label.toLowerCase().replaceAll(' ', '-')}`;
  let intent = await getTransactionIntent(intentId);
  if (!intent) {
    const prepared = await prepareAction();
    const createdAt = now();
    await insertTransactionIntent({
      id: intentId,
      scopeId: run.id,
      action: label,
      transactionHash: prepared.hash,
      signedTransaction: prepared.serializedTransaction,
      status: 'prepared',
      createdAt,
      updatedAt: createdAt,
    });
    intent = await getTransactionIntent(intentId);
    if (!intent)
      throw new Error('Prepared transaction intent was not persisted');
  }
  if (intent.status === 'prepared') {
    if (!intent.signedTransaction)
      throw new Error('Prepared transaction payload is unavailable');
    try {
      const broadcastHash = await broadcastPrepared(intent.signedTransaction);
      if (broadcastHash !== intent.transactionHash)
        throw new Error('Broadcast hash changed from prepared intent');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already known|nonce too low/i.test(message)) {
        throw new PendingConfirmationError(
          `Prepared ${label.toLowerCase()} transaction awaits broadcast retry`,
        );
      }
    }
    await updateTransactionIntent(intentId, 'broadcast');
    intent.status = 'broadcast';
  }

  const pending = pendingHash(run, label);
  if (!pending) {
    const hash = intent.transactionHash;
    if (!run.txHashes.includes(hash)) run.txHashes.push(hash);
    addTrace(
      run,
      run.stage,
      `${label} broadcast`,
      'Signed intent was persisted before broadcast; confirmation is reconciled before the next action.',
      hash,
    );
    await updateRun(run, lockOwner, false);
    return;
  }
  let event;
  try {
    event = await confirmEvent(pending, eventName, expectedSender);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out|not found|receipt/i.test(message))
      throw new PendingConfirmationError(message);
    throw error;
  }
  await recordEventReceipt(84532, event.hash, event.logIndex, event.eventName);
  onConfirmed(event);
  await updateTransactionIntent(intentId, 'confirmed');
}

function transition(
  run: RunRecord,
  stage: RunStage,
  label: string,
  detail: string,
  txHash?: Hash,
) {
  run.stage = stage;
  addTrace(run, stage, label, detail, txHash);
}

function sameAddress(actual: unknown, expected: string): boolean {
  return (
    typeof actual === 'string' &&
    actual.toLowerCase() === expected.toLowerCase()
  );
}

function sameInteger(actual: unknown, expected: bigint): boolean {
  try {
    return BigInt(String(actual)) === expected;
  } catch {
    return false;
  }
}

function atLeastInteger(actual: unknown, minimum: bigint): boolean {
  try {
    return BigInt(String(actual)) >= minimum;
  } catch {
    return false;
  }
}

function requireEvent(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Receipt validation failed: ${message}`);
}

function shouldRefund(run: RunRecord, listing: ListingRecord): boolean {
  return (
    run.scenario === 'refund' ||
    (run.scenario === 'market' && listing.fixtureKind === 'invalid')
  );
}

async function advanceSimulation(run: RunRecord, listing: ListingRecord) {
  if (run.stage === 'selected') {
    transition(
      run,
      'funded',
      'Escrow funded',
      'Simulation ledger reserved the exact listing price; no transaction hash was fabricated.',
    );
    return;
  }

  if (shouldRefund(run, listing)) {
    if (run.stage === 'funded') {
      const artifact = await loadArtifact(listing);
      if (artifact.validation.valid)
        throw new Error(
          'Fault-injection artifact unexpectedly passed validation',
        );
      run.result = {
        ...startingResult(run.goal, run.result?.selectionMode),
        validation: artifact.validation,
        refundReason: artifact.validation.errors[0] || 'invalid artifact',
        afterDecision:
          'No route selected; payment returned because the artifact failed its stated terms.',
      };
      transition(
        run,
        'refunded',
        'Evaluator rejected artifact',
        'Malformed evidence was rejected before buyer reveal; refund credited to the buyer.',
      );
      return;
    }
    if (run.stage === 'refunded') {
      run.status = 'refunded';
      transition(
        run,
        'complete',
        'Refund withdrawn',
        'Buyer withdrew the credited simulation refund; the seller received nothing.',
      );
    }
    return;
  }

  if (run.stage === 'funded') {
    const artifact = await loadArtifact(listing);
    if (!artifact.validation.valid)
      throw new Error(
        `Evaluator preflight failed: ${artifact.validation.errors.join(', ')}`,
      );
    transition(
      run,
      'delivered',
      'Delivery attested',
      'Evaluator matched the private object to the listing commitment and opened the review window.',
    );
    return;
  }
  if (run.stage === 'delivered') {
    const artifact = await loadArtifact(listing);
    if (!artifact.report) throw new Error('Paid artifact could not be decoded');
    run.result = {
      ...run.result!,
      report: artifact.report,
      validation: artifact.validation,
    };
    transition(
      run,
      'revealed',
      'Evidence unlocked',
      'The token-authorized buyer received the exact committed envelope from private storage.',
    );
    return;
  }
  if (run.stage === 'revealed') {
    const artifact = await loadArtifact(listing);
    if (!artifact.validation.valid || !artifact.report)
      throw new Error(artifact.validation.errors.join(', '));
    run.result = {
      ...run.result!,
      report: artifact.report,
      validation: artifact.validation,
    };
    transition(
      run,
      'verified',
      'Evidence recomputed',
      'All 32 outputs, labels, scores, finite timings, and aggregates matched the purchased terms.',
    );
    return;
  }
  if (run.stage === 'verified') {
    const artifact = await loadArtifact(listing);
    const report = artifact.report;
    if (!artifact.validation.valid || !report)
      throw new Error('Verified report is unavailable');
    const route = chooseRoute([priorReport(), report], run.goal);
    run.selectedCandidateId = route.candidateId;
    run.result = {
      ...(run.result ?? startingResult(run.goal)),
      route,
      afterDecision: route.reason,
    };
    transition(
      run,
      'accepted',
      'Buyer accepted evidence',
      'Valid evidence changed the buyer from abstention to a task-specific routing choice.',
    );
    return;
  }
  if (run.stage === 'accepted') {
    run.status = 'complete';
    transition(
      run,
      'complete',
      'Seller withdrew proceeds',
      'The simulated seller credit was withdrawn; the run is terminal.',
    );
  }
}

async function advanceLive(
  run: RunRecord,
  listing: ListingRecord,
  lockOwner: string,
) {
  const orderId = run.contractOrderId ? BigInt(run.contractOrderId) : null;
  const actors = chainActors();
  if (run.stage === 'selected') {
    const requestId = requestIdFor(run.id);
    const network = publicChainInfo().chainName;
    await liveTransaction(
      run,
      lockOwner,
      'Funding',
      'OrderFunded',
      actors.buyer,
      () =>
        prepareBuy(
          BigInt(listing.contractListingId!),
          requestId,
          listing.priceWei,
        ),
      (event) => {
        requireEvent(
          sameInteger(event.args.listingId, BigInt(listing.contractListingId!)),
          'listing ID',
        );
        requireEvent(
          sameInteger(event.args.price, listing.priceWei),
          'exact price',
        );
        requireEvent(sameAddress(event.args.buyer, actors.buyer), 'buyer');
        requireEvent(sameAddress(event.args.seller, actors.operator), 'seller');
        requireEvent(
          sameAddress(event.args.evaluator, actors.evaluator),
          'evaluator',
        );
        requireEvent(event.args.requestId === requestId, 'request ID');
        run.contractOrderId = String(event.args.orderId);
        transition(
          run,
          'funded',
          'Escrow funded',
          `Order ${run.contractOrderId} confirmed on ${network}.`,
          event.hash,
        );
      },
    );
    return;
  }
  if (!orderId) throw new Error('Confirmed contract order ID is missing');

  if (shouldRefund(run, listing)) {
    if (run.stage === 'funded') {
      const artifact = await loadArtifact(listing);
      if (artifact.validation.valid)
        throw new Error(
          'Fault-injection artifact unexpectedly passed validation',
        );
      run.result = {
        ...startingResult(run.goal, run.result?.selectionMode),
        validation: artifact.validation,
        refundReason: artifact.validation.errors[0] || 'invalid artifact',
        afterDecision:
          'No route selected; payment returned because the artifact failed its stated terms.',
      };
      await liveTransaction(
        run,
        lockOwner,
        'Refund',
        'OrderRefunded',
        actors.evaluator,
        () =>
          prepareReject(
            orderId,
            keccak256(stringToHex('evalvault:invalid-artifact')),
          ),
        (event) => {
          requireEvent(
            sameInteger(event.args.orderId, orderId),
            'refund order ID',
          );
          requireEvent(
            sameAddress(event.args.buyer, actors.buyer),
            'refund buyer',
          );
          requireEvent(
            sameInteger(event.args.amount, listing.priceWei),
            'refund amount',
          );
          requireEvent(
            sameInteger(event.args.reason, 0n),
            'evaluator rejection reason',
          );
          transition(
            run,
            'refunded',
            'Evaluator rejected artifact',
            'On-chain refund credit confirmed; private report was not revealed.',
            event.hash,
          );
        },
      );
      return;
    }
    if (run.stage === 'refunded') {
      await liveTransaction(
        run,
        lockOwner,
        'Refund withdrawal',
        'Withdrawal',
        actors.buyer,
        () => prepareWithdraw('buyer'),
        (event) => {
          requireEvent(
            sameAddress(event.args.account, actors.buyer),
            'refund withdrawal account',
          );
          requireEvent(
            atLeastInteger(event.args.amount, listing.priceWei),
            'refund withdrawal amount covers this order',
          );
          run.status = 'refunded';
          transition(
            run,
            'complete',
            'Refund withdrawn',
            'Buyer withdrew the on-chain refund credit.',
            event.hash,
          );
        },
      );
    }
    return;
  }

  if (run.stage === 'funded') {
    const artifact = await loadArtifact(listing);
    if (!artifact.validation.valid)
      throw new Error(
        `Evaluator preflight failed: ${artifact.validation.errors.join(', ')}`,
      );
    const receiptHash = keccak256(
      stringToHex(`r2:${listing.objectKey}:${listing.commitment}`),
    );
    const network = publicChainInfo().chainName;
    await liveTransaction(
      run,
      lockOwner,
      'Delivery',
      'OrderDelivered',
      actors.evaluator,
      () => prepareDelivery(orderId, receiptHash),
      (event) => {
        requireEvent(
          sameInteger(event.args.orderId, orderId),
          'delivery order ID',
        );
        requireEvent(
          event.args.receiptHash === receiptHash,
          'delivery receipt hash',
        );
        transition(
          run,
          'delivered',
          'Delivery attested',
          `Evaluator delivery receipt confirmed on ${network}.`,
          event.hash,
        );
      },
    );
    return;
  }
  if (run.stage === 'delivered') {
    const artifact = await loadArtifact(listing);
    if (!artifact.report) throw new Error('Paid artifact could not be decoded');
    run.result = {
      ...run.result!,
      report: artifact.report,
      validation: artifact.validation,
    };
    transition(
      run,
      'revealed',
      'Evidence unlocked',
      'The authorized buyer received the bytes committed by the listing.',
    );
    return;
  }
  if (run.stage === 'revealed') {
    const artifact = await loadArtifact(listing);
    if (!artifact.validation.valid || !artifact.report)
      throw new Error(artifact.validation.errors.join(', '));
    run.result = {
      ...run.result!,
      report: artifact.report,
      validation: artifact.validation,
    };
    transition(
      run,
      'verified',
      'Evidence recomputed',
      'Commitment, provenance envelope, listing terms, and all deterministic outputs passed.',
    );
    return;
  }
  if (run.stage === 'verified') {
    const artifact = await loadArtifact(listing);
    const report = artifact.report;
    if (!artifact.validation.valid || !report)
      throw new Error('Verified report is unavailable');
    const route = chooseRoute([priorReport(), report], run.goal);
    run.selectedCandidateId = route.candidateId;
    run.result = {
      ...(run.result ?? startingResult(run.goal)),
      route,
      afterDecision: route.reason,
    };
    await liveTransaction(
      run,
      lockOwner,
      'Acceptance',
      'OrderReleased',
      actors.buyer,
      () => prepareAccept(orderId),
      (event) => {
        requireEvent(
          sameInteger(event.args.orderId, orderId),
          'released order ID',
        );
        requireEvent(
          sameAddress(event.args.seller, actors.operator),
          'released seller',
        );
        requireEvent(
          sameInteger(event.args.amount, listing.priceWei),
          'released amount',
        );
        transition(
          run,
          'accepted',
          'Buyer accepted evidence',
          `Order ${orderId} released to the seller after the routing decision changed.`,
          event.hash,
        );
      },
    );
    return;
  }
  if (run.stage === 'accepted') {
    const network = publicChainInfo().chainName;
    await liveTransaction(
      run,
      lockOwner,
      'Seller withdrawal',
      'Withdrawal',
      actors.operator,
      () => prepareWithdraw('operator'),
      (event) => {
        requireEvent(
          sameAddress(event.args.account, actors.operator),
          'seller withdrawal account',
        );
        requireEvent(
          atLeastInteger(event.args.amount, listing.priceWei),
          'seller withdrawal amount covers this order',
        );
        run.status = 'complete';
        transition(
          run,
          'complete',
          'Seller withdrew proceeds',
          `Seller proceeds withdrawal confirmed on ${network}.`,
          event.hash,
        );
      },
    );
  }
}

export async function advanceRun(id: string, request: Request) {
  const initial = await authorizedRun(id, request);
  if (!initial) return null;
  assertPublicRunAccess(initial);
  if (initial.expiresAt < now()) throw new Error('Run token expired');
  if (initial.stage === 'complete' || initial.stage === 'failed')
    return getPublicRun(initial);
  const lockOwner = crypto.randomUUID();
  if (!(await claimRun(id, lockOwner)))
    throw new RunBusyError('Another request is already advancing this run');

  try {
    const run = await getRun(id);
    if (!run) throw new Error('Run disappeared after lock acquisition');
    const listing = run.selectedListingId
      ? await getListing(run.selectedListingId)
      : null;
    assertListingVersion(run, listing);
    try {
      if (run.chainMode === 'live') await advanceLive(run, listing, lockOwner);
      else await advanceSimulation(run, listing);
      await updateRun(run, lockOwner);
      return {
        run: await hydratedPublicRun(run, listing),
        chain: publicChainInfo(),
      };
    } catch (error) {
      if (error instanceof PendingConfirmationError) throw error;
      if (error instanceof RunLockLostError) {
        throw new RunBusyError(
          'Run ownership changed while this step was executing; retry from persisted state',
        );
      }
      run.status = 'failed';
      run.stage = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      addTrace(run, 'failed', 'Run stopped', run.error);
      await updateRun(run, lockOwner);
      return {
        run: await hydratedPublicRun(run, listing),
        chain: publicChainInfo(),
      };
    }
  } finally {
    await releaseRun(id, lockOwner);
  }
}
