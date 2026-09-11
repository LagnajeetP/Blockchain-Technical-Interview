export type Queue = 'billing' | 'technical' | 'account' | 'escalate';
export type Urgency = 'high' | 'normal';
export type Goal = 'speed' | 'balanced' | 'quality';

export interface Ticket { id: string; subject: string; body: string; }
export interface RoutingOutput { queue: Queue; urgency: Urgency; }
export interface EvaluationCase { id: string; input: Ticket; expected: RoutingOutput; actual: RoutingOutput; latencyMs: number; correct: boolean; }
export interface EvaluationMetrics { accuracy: number; p50Ms: number; p95Ms: number; }
export interface PrivateEvaluationReport {
  evaluationSeed: string; candidateId: string; candidateConfig: string; suiteVersion: string; observedAt: number;
  sampleCount: number; cases: EvaluationCase[]; metrics: EvaluationMetrics;
}
export interface PublicListing {
  id: string; candidateId: string; title: string; summary: string; priceWei: bigint;
  observedAt: number; expiresAt: number; suiteVersion: string; sampleCount: number;
  provenance: string; commitment: string; status: 'active' | 'expired' | 'sold';
}
export interface EvidenceRequest { goal: Goal; budgetWei: bigint; maxAgeMs: number; purchasedIds: string[]; }
export interface ListingDecision { listingId: string; accepted: boolean; reason: string; }
export interface Selection { chosen: PublicListing | null; decisions: ListingDecision[]; }
