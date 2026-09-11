export interface SellerInventoryItem {
  candidateId: string;
  suiteVersion: string;
  observedAt: number;
  expiresAt: number;
  termsHash: string;
}

export interface SellerMandate {
  candidateId: string;
  suiteVersion: string;
  expectedTermsHash: string;
  maxEvidenceAgeMs: number;
  minimumShelfLifeMs: number;
  evaluationCostWei: bigint;
  markupBps: number;
  minimumPriceWei: bigint;
}

export interface SellerPlan {
  action: "publish" | "refresh" | "hold";
  candidateId: string;
  priceWei: bigint;
  reason: string;
  nextReviewAt: number;
}

export function priceEvidence(
  evaluationCostWei: bigint,
  markupBps: number,
  minimumPriceWei: bigint,
): bigint {
  if (evaluationCostWei < 0n || minimumPriceWei <= 0n)
    throw new Error("seller costs must be non-negative");
  if (!Number.isInteger(markupBps) || markupBps < 0 || markupBps > 100_000) {
    throw new Error("seller markup must be an integer between 0 and 100000 basis points");
  }
  const costBased = evaluationCostWei + (evaluationCostWei * BigInt(markupBps)) / 10_000n;
  return costBased > minimumPriceWei ? costBased : minimumPriceWei;
}

/** A deterministic seller policy: publish only for declared coverage, then refresh on expiry, age, or term changes. */
export function planSellerListing(
  inventory: SellerInventoryItem[],
  mandate: SellerMandate,
  now: number,
): SellerPlan {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(mandate.maxEvidenceAgeMs) ||
    mandate.maxEvidenceAgeMs <= 0
  ) {
    throw new Error("seller timing policy is invalid");
  }
  if (!Number.isFinite(mandate.minimumShelfLifeMs) || mandate.minimumShelfLifeMs < 0) {
    throw new Error("seller shelf-life policy is invalid");
  }
  const priceWei = priceEvidence(
    mandate.evaluationCostWei,
    mandate.markupBps,
    mandate.minimumPriceWei,
  );
  const matching = inventory
    .filter(
      (item) =>
        item.candidateId === mandate.candidateId && item.suiteVersion === mandate.suiteVersion,
    )
    .sort((a, b) => b.observedAt - a.observedAt)[0];
  if (!matching) {
    return {
      action: "publish",
      candidateId: mandate.candidateId,
      priceWei,
      reason: "declared buyer coverage has no matching dossier",
      nextReviewAt: now,
    };
  }
  if (matching.termsHash !== mandate.expectedTermsHash) {
    return {
      action: "refresh",
      candidateId: mandate.candidateId,
      priceWei,
      reason: "candidate configuration or committed terms changed",
      nextReviewAt: now,
    };
  }
  if (now - matching.observedAt > mandate.maxEvidenceAgeMs) {
    return {
      action: "refresh",
      candidateId: mandate.candidateId,
      priceWei,
      reason: "newest matching dossier exceeded the freshness policy",
      nextReviewAt: now,
    };
  }
  if (matching.expiresAt - now < mandate.minimumShelfLifeMs) {
    return {
      action: "refresh",
      candidateId: mandate.candidateId,
      priceWei,
      reason: "matching dossier is too close to expiry",
      nextReviewAt: now,
    };
  }
  return {
    action: "hold",
    candidateId: mandate.candidateId,
    priceWei,
    reason: "fresh matching inventory already covers declared buyer demand",
    nextReviewAt: Math.min(
      matching.observedAt + mandate.maxEvidenceAgeMs,
      matching.expiresAt - mandate.minimumShelfLifeMs,
    ),
  };
}
