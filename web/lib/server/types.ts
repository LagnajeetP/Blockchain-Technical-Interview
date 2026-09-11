import type {
  Goal,
  PrivateEvaluationReport,
  PublicListing,
} from '@/lib/evidence';

export type Scenario = 'success' | 'refund';
export type ChainMode = 'simulation' | 'live';
export type RunStage =
  | 'selected'
  | 'funded'
  | 'delivered'
  | 'revealed'
  | 'verified'
  | 'accepted'
  | 'complete'
  | 'refunded'
  | 'failed';

export interface TraceEntry {
  stage: RunStage | 'created';
  label: string;
  at: number;
  elapsedMs: number;
  detail: string;
  txHash?: `0x${string}`;
}

export interface RunRecord {
  id: string;
  scenario: Scenario;
  goal: Goal;
  status: 'running' | 'complete' | 'refunded' | 'failed';
  stage: RunStage;
  chainMode: ChainMode;
  selectedListingId: string | null;
  selectedListingCommitment: string | null;
  selectedCandidateId: string | null;
  decisionReason: string | null;
  contractOrderId: string | null;
  trace: TraceEntry[];
  txHashes: `0x${string}`[];
  result: RunResult | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface RunResult {
  report?: PrivateEvaluationReport;
  validation?: {
    valid: boolean;
    errors: string[];
    checks: {
      integrity: boolean;
      provenance: boolean;
      terms: boolean;
      recomputed: boolean;
    };
  };
  route?: { candidateId: string | null; reason: string };
  refundReason?: string;
  beforeDecision: string;
  afterDecision: string;
}

export interface ListingRecord extends PublicListing {
  contractListingId: string | null;
  termsHash: `0x${string}`;
  objectKey: string;
  fixtureKind: 'valid' | 'invalid';
}

export type PublicListingRecord = Omit<
  ListingRecord,
  'priceWei' | 'objectKey' | 'fixtureKind'
> & {
  priceWei: string;
};

export interface PublicRun extends RunRecord {
  listing: PublicListingRecord | null;
}
