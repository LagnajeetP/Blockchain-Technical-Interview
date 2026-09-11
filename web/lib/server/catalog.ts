import { env } from 'cloudflare:workers';
import { keccak256, stringToHex } from 'viem';
import {
  createEvaluation,
  DEMO_SEED,
  planSellerListing,
  type PrivateEvaluationReport,
  type SellerPlan,
} from '@/lib/evidence';
import { listListings, upsertListing } from '@/lib/server/db';
import { serializeEnvelope } from '@/lib/server/crypto';
import type { ListingRecord, PublicListingRecord } from '@/lib/server/types';

const DAY_MS = 86_400_000;
const SELLER_MAX_AGE_MS = 6 * 60 * 60_000;
const SELLER_MINIMUM_SHELF_LIFE_MS = DAY_MS;
const SELLER_EVALUATION_COST_WEI = 800_000_000_000n;
const SELLER_MARKUP_BPS = 2_500;
const SELLER_MINIMUM_PRICE_WEI = 500_000_000_000n;
export const PRIOR_LISTING_ID = 'ev-fast-32';
export const SUCCESS_LISTING_ID = 'ev-context-32';
export const FAULT_LISTING_ID = 'ev-fault-32';

export const COMMODITY_TERMS = {
  access: 'Non-exclusive internal evaluation use',
  redistribution: 'Not granted',
  delivery: 'Private report after evaluator approval',
  buyerProtection:
    'Refund on byte, commitment, schema, or recomputation failure',
  verification: 'Commitment match and deterministic recomputation',
} as const;

export interface PublicSellerPlan {
  agentId: string;
  action: SellerPlan['action'];
  candidateId: string;
  priceWei: string;
  reason: string;
  nextReviewAt: number;
  policy: string;
}

type ListingTemplate = {
  id: string;
  candidateId: 'fast-keyword' | 'contextual-rules';
  title: string;
  summary: string;
  priceWei: bigint;
  ageMs: number;
  sampleCount?: number;
  fixtureKind: 'valid' | 'invalid';
};

const templates: ListingTemplate[] = [
  {
    id: SUCCESS_LISTING_ID,
    candidateId: 'contextual-rules',
    title: 'Context-aware routing · sealed evaluation A',
    summary:
      'Task-matched 32-case evidence for support ticket queue and urgency routing.',
    priceWei: BigInt('1000000000000'),
    ageMs: 8 * 60_000,
    fixtureKind: 'valid',
  },
  {
    id: PRIOR_LISTING_ID,
    candidateId: 'fast-keyword',
    title: 'Keyword router · owned baseline',
    summary:
      'A previously acquired report used to detect the current evidence gap.',
    priceWei: BigInt('500000000000'),
    ageMs: 41 * 60_000,
    fixtureKind: 'valid',
  },
  {
    id: 'ev-stale-18',
    candidateId: 'contextual-rules',
    title: 'General support benchmark · stale',
    summary:
      'A deliberately stale listing that demonstrates metadata-only rejection.',
    priceWei: BigInt('100000000000'),
    ageMs: 9 * DAY_MS,
    fixtureKind: 'valid',
  },
  {
    id: FAULT_LISTING_ID,
    candidateId: 'contextual-rules',
    title: 'Context-aware routing · sealed evaluation B',
    summary:
      'A second 32-case dossier offered under the same scope, price, and verification terms.',
    priceWei: BigInt('1000000000000'),
    ageMs: 5 * 60_000,
    fixtureKind: 'invalid',
  },
];

function corruptReport(report: ReturnType<typeof createEvaluation>) {
  const copy = structuredClone(report);
  copy.cases[0].actual.queue =
    copy.cases[0].actual.queue === 'billing' ? 'technical' : 'billing';
  return copy;
}

export function termsHashForReport(
  report: PrivateEvaluationReport,
  claimedSampleCount = report.sampleCount,
): `0x${string}` {
  return keccak256(
    stringToHex(
      JSON.stringify({
        schema: 'evalvault-terms-v1',
        suiteVersion: report.suiteVersion,
        candidateId: report.candidateId,
        candidateConfig: report.candidateConfig,
        sampleCount: claimedSampleCount,
        testSetCommitment: keccak256(stringToHex(report.evaluationSeed)),
        ...COMMODITY_TERMS,
      }),
    ),
  );
}

function currentSellerPlan(
  listings: ListingRecord[],
  now = Date.now(),
): SellerPlan {
  const seed = env.EVALUATION_SEED || DEMO_SEED;
  const report = createEvaluation(seed, 'contextual-rules');
  return planSellerListing(
    listings.map((listing) => ({
      candidateId: listing.candidateId,
      suiteVersion: listing.suiteVersion,
      observedAt: listing.observedAt,
      expiresAt: listing.expiresAt,
      termsHash: listing.termsHash,
    })),
    {
      candidateId: 'contextual-rules',
      suiteVersion: report.suiteVersion,
      expectedTermsHash: termsHashForReport(report),
      maxEvidenceAgeMs: SELLER_MAX_AGE_MS,
      minimumShelfLifeMs: SELLER_MINIMUM_SHELF_LIFE_MS,
      evaluationCostWei: SELLER_EVALUATION_COST_WEI,
      markupBps: SELLER_MARKUP_BPS,
      minimumPriceWei: SELLER_MINIMUM_PRICE_WEI,
    },
    now,
  );
}

export function publicSellerPlan(listings: ListingRecord[]): PublicSellerPlan {
  const plan = currentSellerPlan(listings);
  return {
    agentId: 'seller.eval-lab-01',
    action: plan.action,
    candidateId: plan.candidateId,
    priceWei: plan.priceWei.toString(),
    reason: plan.reason,
    nextReviewAt: plan.nextReviewAt,
    policy:
      'refresh on missing, changed, stale, or near-expiry coverage; price = max(500 gwei, measured cost + 25%)',
  };
}

export async function createDemoCatalog(
  contractIds: Partial<Record<string, string>> = {},
): Promise<ListingRecord[]> {
  if (!env.FILES) throw new Error('R2 binding FILES is unavailable');
  const now = Date.now();
  const seed = env.EVALUATION_SEED || DEMO_SEED;
  const sellerPrice = currentSellerPlan([], now).priceWei;
  const records: ListingRecord[] = [];

  for (const template of templates) {
    let report = createEvaluation(seed, template.candidateId);
    report.observedAt = now - template.ageMs;
    if (template.fixtureKind === 'invalid') report = corruptReport(report);
    const { serialized, commitment } = serializeEnvelope(report);
    const objectKey = `reports/${template.id}/${commitment.slice(2)}.json`;
    await env.FILES.put(objectKey, serialized, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { schema: 'evalvault-report-v1', listingId: template.id },
    });

    const record: ListingRecord = {
      id: template.id,
      contractListingId: contractIds[template.id] ?? null,
      candidateId: template.candidateId,
      title: template.title,
      summary: template.summary,
      priceWei:
        template.id === SUCCESS_LISTING_ID ? sellerPrice : template.priceWei,
      observedAt: report.observedAt,
      expiresAt: now + 7 * DAY_MS,
      suiteVersion: report.suiteVersion,
      sampleCount: template.sampleCount ?? report.sampleCount,
      provenance: 'EvalVault operator · private deterministic evaluator',
      commitment,
      termsHash: termsHashForReport(
        report,
        template.sampleCount ?? report.sampleCount,
      ),
      objectKey,
      status: 'active',
      fixtureKind: template.fixtureKind,
    };
    await upsertListing(record);
    records.push(record);
  }
  return records;
}

export async function ensureDemoCatalog(): Promise<ListingRecord[]> {
  const stored = await listListings();
  const current = await Promise.all(
    stored.map(async (listing) => {
      const template = templates.find((item) => item.id === listing.id);
      if (
        !template ||
        (listing.title === template.title &&
          listing.summary === template.summary)
      ) {
        return listing;
      }
      const refreshed = {
        ...listing,
        title: template.title,
        summary: template.summary,
      };
      await upsertListing(refreshed);
      return refreshed;
    }),
  );
  const expectedSeed = env.EVALUATION_SEED || DEMO_SEED;
  const expectedTerms = termsHashForReport(
    createEvaluation(expectedSeed, 'contextual-rules'),
  );
  const success = current.find((listing) => listing.id === SUCCESS_LISTING_ID);
  const seedChangedBeforeOnchainPublish = Boolean(
    success &&
    !success.contractListingId &&
    success.termsHash !== expectedTerms,
  );
  const simulationHasPublishedListings =
    env.DEMO_CHAIN_MODE !== 'live' &&
    current.some((listing) => Boolean(listing.contractListingId));
  const shouldRefresh =
    current.length < templates.length ||
    current.some(
      (listing) =>
        listing.provenance !==
        'EvalVault operator · private deterministic evaluator',
    ) ||
    seedChangedBeforeOnchainPublish ||
    simulationHasPublishedListings ||
    (env.DEMO_CHAIN_MODE !== 'live' &&
      currentSellerPlan(current).action !== 'hold');
  return shouldRefresh ? createDemoCatalog() : current;
}

export function toPublicListing(listing: ListingRecord): PublicListingRecord {
  const {
    objectKey: _objectKey,
    fixtureKind: _fixtureKind,
    priceWei,
    ...safe
  } = listing;
  return { ...safe, priceWei: priceWei.toString() };
}

export async function readEnvelope(listing: ListingRecord): Promise<string> {
  if (!env.FILES) throw new Error('R2 binding FILES is unavailable');
  const object = await env.FILES.get(listing.objectKey);
  if (!object)
    throw new Error(`Private artifact unavailable for ${listing.id}`);
  return object.text();
}
