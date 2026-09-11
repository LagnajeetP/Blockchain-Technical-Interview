import { env } from 'cloudflare:workers';
import type { ListingRecord, RunRecord } from '@/lib/server/types';

type ListingRow = {
  id: string;
  contract_listing_id: string | null;
  candidate_id: string;
  title: string;
  summary: string;
  price_wei: string;
  observed_at: number;
  expires_at: number;
  suite_version: string;
  sample_count: number;
  provenance: string;
  commitment: string;
  terms_hash: string;
  object_key: string;
  status: ListingRecord['status'];
  fixture_kind: ListingRecord['fixtureKind'];
  created_at: number;
};

type RunRow = {
  id: string;
  token_hash: string;
  scenario: RunRecord['scenario'];
  goal: RunRecord['goal'];
  status: RunRecord['status'];
  stage: RunRecord['stage'];
  chain_mode: RunRecord['chainMode'];
  selected_listing_id: string | null;
  selected_listing_commitment: string | null;
  selected_candidate_id: string | null;
  decision_reason: string | null;
  contract_order_id: string | null;
  trace_json: string;
  tx_hashes_json: string;
  result_json: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
};

export interface StoredRun extends RunRecord {
  tokenHash: string;
}

export interface TransactionIntent {
  id: string;
  scopeId: string;
  action: string;
  transactionHash: `0x${string}`;
  signedTransaction: `0x${string}` | null;
  status: 'prepared' | 'broadcast' | 'confirmed';
  createdAt: number;
  updatedAt: number;
}

export class RunLockLostError extends Error {
  constructor() {
    super('Run lock ownership lost');
  }
}

function binding(): D1Database {
  if (!env.DB) throw new Error('D1 binding DB is unavailable');
  return env.DB;
}

function listingFromRow(row: ListingRow): ListingRecord {
  return {
    id: row.id,
    contractListingId: row.contract_listing_id,
    candidateId: row.candidate_id,
    title: row.title,
    summary: row.summary,
    priceWei: BigInt(row.price_wei),
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    suiteVersion: row.suite_version,
    sampleCount: row.sample_count,
    provenance: row.provenance,
    commitment: row.commitment,
    termsHash: row.terms_hash as `0x${string}`,
    objectKey: row.object_key,
    status: row.status,
    fixtureKind: row.fixture_kind,
  };
}

function runFromRow(row: RunRow): StoredRun {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    scenario: row.scenario,
    goal: row.goal,
    status: row.status,
    stage: row.stage,
    chainMode: row.chain_mode,
    selectedListingId: row.selected_listing_id,
    selectedListingCommitment: row.selected_listing_commitment,
    selectedCandidateId: row.selected_candidate_id,
    decisionReason: row.decision_reason,
    contractOrderId: row.contract_order_id,
    trace: JSON.parse(row.trace_json),
    txHashes: JSON.parse(row.tx_hashes_json),
    result: row.result_json ? JSON.parse(row.result_json) : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function serializeResult(run: RunRecord): string | null {
  if (!run.result) return null;
  const { report: _report, ...persisted } = run.result;
  return JSON.stringify(persisted);
}

export async function listListings(): Promise<ListingRecord[]> {
  const rows = await binding()
    .prepare('SELECT * FROM listings ORDER BY created_at DESC, id ASC')
    .all<ListingRow>();
  return rows.results.map(listingFromRow);
}

export async function getListing(id: string): Promise<ListingRecord | null> {
  const row = await binding()
    .prepare('SELECT * FROM listings WHERE id = ?')
    .bind(id)
    .first<ListingRow>();
  return row ? listingFromRow(row) : null;
}

export async function upsertListing(listing: ListingRecord): Promise<void> {
  await binding()
    .prepare(
      `INSERT INTO listings (
        id, contract_listing_id, candidate_id, title, summary, price_wei, observed_at,
        expires_at, suite_version, sample_count, provenance, commitment, terms_hash,
        object_key, status, fixture_kind, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        contract_listing_id = excluded.contract_listing_id,
        candidate_id = excluded.candidate_id,
        title = excluded.title,
        summary = excluded.summary,
        price_wei = excluded.price_wei,
        observed_at = excluded.observed_at,
        expires_at = excluded.expires_at,
        suite_version = excluded.suite_version,
        sample_count = excluded.sample_count,
        provenance = excluded.provenance,
        commitment = excluded.commitment,
        terms_hash = excluded.terms_hash,
        object_key = excluded.object_key,
        status = excluded.status,
        fixture_kind = excluded.fixture_kind,
        created_at = excluded.created_at`,
    )
    .bind(
      listing.id,
      listing.contractListingId,
      listing.candidateId,
      listing.title,
      listing.summary,
      listing.priceWei.toString(),
      listing.observedAt,
      listing.expiresAt,
      listing.suiteVersion,
      listing.sampleCount,
      listing.provenance,
      listing.commitment,
      listing.termsHash,
      listing.objectKey,
      listing.status,
      listing.fixtureKind,
      Date.now(),
    )
    .run();
}

export async function insertRun(
  run: RunRecord,
  tokenHash: string,
): Promise<void> {
  await binding()
    .prepare(
      `INSERT INTO agent_runs (
        id, token_hash, scenario, goal, status, stage, chain_mode, selected_listing_id,
        selected_listing_commitment, selected_candidate_id, decision_reason,
        contract_order_id, trace_json, tx_hashes_json, result_json, error, lock_until,
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .bind(
      run.id,
      tokenHash,
      run.scenario,
      run.goal,
      run.status,
      run.stage,
      run.chainMode,
      run.selectedListingId,
      run.selectedListingCommitment,
      run.selectedCandidateId,
      run.decisionReason,
      run.contractOrderId,
      JSON.stringify(run.trace),
      JSON.stringify(run.txHashes),
      serializeResult(run),
      run.error,
      run.createdAt,
      run.updatedAt,
      run.expiresAt,
    )
    .run();
}

export async function getRun(id: string): Promise<StoredRun | null> {
  const row = await binding()
    .prepare('SELECT * FROM agent_runs WHERE id = ?')
    .bind(id)
    .first<RunRow>();
  return row ? runFromRow(row) : null;
}

export async function updateRun(
  run: RunRecord,
  lockOwner: string,
  releaseLock = true,
): Promise<void> {
  const result = await binding()
    .prepare(
      `UPDATE agent_runs SET
        status = ?, stage = ?, selected_listing_id = ?, selected_candidate_id = ?,
        decision_reason = ?, contract_order_id = ?, trace_json = ?, tx_hashes_json = ?,
        result_json = ?, error = ?, updated_at = ?, expires_at = ?, lock_until = ?, lock_owner = ?
      WHERE id = ? AND lock_owner = ?`,
    )
    .bind(
      run.status,
      run.stage,
      run.selectedListingId,
      run.selectedCandidateId,
      run.decisionReason,
      run.contractOrderId,
      JSON.stringify(run.trace),
      JSON.stringify(run.txHashes),
      serializeResult(run),
      run.error,
      run.updatedAt,
      run.expiresAt,
      releaseLock ? 0 : Date.now() + 60_000,
      releaseLock ? null : lockOwner,
      run.id,
      lockOwner,
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new RunLockLostError();
}

export async function claimRun(
  id: string,
  lockOwner: string,
  now = Date.now(),
): Promise<boolean> {
  const result = await binding()
    .prepare(
      'UPDATE agent_runs SET lock_until = ?, lock_owner = ? WHERE id = ? AND lock_until < ?',
    )
    .bind(now + 60_000, lockOwner, id, now)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function releaseRun(id: string, lockOwner: string): Promise<void> {
  await binding()
    .prepare(
      'UPDATE agent_runs SET lock_until = 0, lock_owner = NULL WHERE id = ? AND lock_owner = ?',
    )
    .bind(id, lockOwner)
    .run();
}

export async function countRecentLiveRuns(since: number): Promise<number> {
  const row = await binding()
    .prepare(
      "SELECT COUNT(*) AS count FROM agent_runs WHERE chain_mode = 'live' AND created_at >= ?",
    )
    .bind(since)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function claimLiveRunLease(
  runId: string,
  timestamp = Date.now(),
): Promise<boolean> {
  const bucket = `minute:${Math.floor(timestamp / 60_000)}`;
  try {
    await binding()
      .prepare(
        'INSERT INTO live_run_leases (id, run_id, created_at) VALUES (?, ?, ?)',
      )
      .bind(bucket, runId, timestamp)
      .run();
    return true;
  } catch (error) {
    if (
      /unique|constraint/i.test(
        error instanceof Error ? error.message : String(error),
      )
    )
      return false;
    throw error;
  }
}

export async function getTransactionIntent(
  id: string,
): Promise<TransactionIntent | null> {
  const row = await binding()
    .prepare('SELECT * FROM transaction_intents WHERE id = ?')
    .bind(id)
    .first<{
      id: string;
      scope_id: string;
      action: string;
      transaction_hash: `0x${string}`;
      signed_transaction: `0x${string}` | null;
      status: TransactionIntent['status'];
      created_at: number;
      updated_at: number;
    }>();
  return row
    ? {
        id: row.id,
        scopeId: row.scope_id,
        action: row.action,
        transactionHash: row.transaction_hash,
        signedTransaction: row.signed_transaction,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;
}

export async function insertTransactionIntent(
  intent: TransactionIntent,
): Promise<void> {
  await binding()
    .prepare(
      `INSERT OR IGNORE INTO transaction_intents
        (id, scope_id, action, transaction_hash, signed_transaction, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      intent.id,
      intent.scopeId,
      intent.action,
      intent.transactionHash,
      intent.signedTransaction,
      intent.status,
      intent.createdAt,
      intent.updatedAt,
    )
    .run();
}

export async function updateTransactionIntent(
  id: string,
  status: TransactionIntent['status'],
): Promise<void> {
  await binding()
    .prepare(
      "UPDATE transaction_intents SET status = ?, signed_transaction = CASE WHEN ? = 'confirmed' THEN NULL ELSE signed_transaction END, updated_at = ? WHERE id = ?",
    )
    .bind(status, status, Date.now(), id)
    .run();
}

export async function recordEventReceipt(
  chainId: number,
  transactionHash: `0x${string}`,
  logIndex: number,
  eventName: string,
): Promise<void> {
  const id = `${chainId}:${transactionHash}:${logIndex}`;
  await binding()
    .prepare(
      'INSERT OR IGNORE INTO event_receipts (id, chain_id, transaction_hash, log_index, event_name, observed_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(id, chainId, transactionHash, logIndex, eventName, Date.now())
    .run();
}
