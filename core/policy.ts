import type { EvidenceRequest, Goal, PrivateEvaluationReport, PublicListing, Selection } from './types';
import { validateReport } from './evaluation';

const floor: Record<Goal, number> = { speed: .8, balanced: .85, quality: .9 };
export function selectEvidence(listings: PublicListing[], request: EvidenceRequest, now: number): Selection {
  const decisions = listings.map(l => { let reason = ''; if (request.purchasedIds.includes(l.id)) reason = 'already purchased'; else if (l.status !== 'active') reason = 'listing inactive'; else if (l.priceWei > request.budgetWei) reason = 'over budget'; else if (!Number.isFinite(l.observedAt) || !Number.isFinite(l.expiresAt) || now - l.observedAt > request.maxAgeMs || now > l.expiresAt) reason = 'stale evidence'; return { listingId: l.id, accepted: !reason, reason: reason || 'eligible from public metadata' }; });
  const eligible = listings.filter((_, i) => decisions[i].accepted);
  const cmpText = (a:string,b:string) => a < b ? -1 : a > b ? 1 : 0;
  const compare = (a:PublicListing,b:PublicListing) => {
    const aSamples = Number.isFinite(a.sampleCount) ? a.sampleCount : -Infinity;
    const bSamples = Number.isFinite(b.sampleCount) ? b.sampleCount : -Infinity;
    let result = request.goal === 'quality' ? bSamples - aSamples : a.priceWei < b.priceWei ? -1 : a.priceWei > b.priceWei ? 1 : 0;
    if (result === 0 && request.goal === 'quality') result = a.priceWei < b.priceWei ? -1 : a.priceWei > b.priceWei ? 1 : 0;
    if (result === 0) {
      const aObserved = Number.isFinite(a.observedAt) ? a.observedAt : Infinity;
      const bObserved = Number.isFinite(b.observedAt) ? b.observedAt : Infinity;
      result = aObserved - bObserved;
    }
    if (result === 0) result = cmpText(a.candidateId,b.candidateId);
    if (result === 0) result = cmpText(a.id,b.id);
    return result;
  };
  eligible.sort(compare);
  return { chosen: eligible[0] ?? null, decisions };
}
export function chooseRoute(reports: PrivateEvaluationReport[], goal: Goal): { candidateId: string | null; reason: string } {
  const eligible = reports.filter(r => validateReport(r, r.evaluationSeed).valid && r.metrics.accuracy >= floor[goal]); if (!eligible.length) return { candidateId: null, reason: `abstain: no report reaches ${floor[goal]}` };
  eligible.sort((a, b) => {
    let result = goal === 'quality' ? b.metrics.accuracy - a.metrics.accuracy : a.metrics.p50Ms - b.metrics.p50Ms;
    if (result === 0) result = goal === 'quality' ? a.metrics.p50Ms - b.metrics.p50Ms : b.metrics.accuracy - a.metrics.accuracy;
    if (result === 0) result = a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
    return result;
  });
  const best = eligible[0]; return { candidateId: best.candidateId, reason: `${best.candidateId} meets ${floor[goal]} accuracy floor; selected by ${goal} policy using observed accuracy and p50 latency` };
}
