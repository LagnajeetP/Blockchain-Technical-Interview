import test from "node:test";
import assert from "node:assert/strict";
import { createEvaluation, validateReport } from "./evaluation";
import { chooseRoute, selectEvidence } from "./policy";
import { planSellerListing, priceEvidence } from "./seller";
test("creates and validates reports with honest score separation", () => {
  const fast = createEvaluation("evalvault-demo-v1", "fast-keyword");
  const strong = createEvaluation("evalvault-demo-v1", "contextual-rules");
  assert.equal(fast.sampleCount, 32);
  assert.ok(fast.metrics.accuracy >= 0.7 && fast.metrics.accuracy <= 0.82);
  assert.ok(strong.metrics.accuracy >= 0.9);
  assert.ok(fast.cases.some((c) => !c.correct));
  assert.equal(validateReport(strong).valid, true);
});
test("context rules behave differently on security and refund context", () => {
  const a = createEvaluation("demo-seed", "fast-keyword");
  const b = createEvaluation("demo-seed", "contextual-rules");
  assert.ok(a.cases.some((x, i) => x.actual.queue !== b.cases[i].actual.queue));
});
test("policy never uses hidden metrics before purchase and can abstain", () => {
  const now = Date.now();
  const listings = [
    {
      id: "a",
      candidateId: "x",
      title: "fresh",
      summary: "scope",
      priceWei: 2n,
      observedAt: now,
      expiresAt: now + 1000,
      suiteVersion: "support-routing-v1",
      sampleCount: 32,
      provenance: "runner",
      commitment: "hash",
      status: "active" as const,
    },
  ];
  assert.equal(
    selectEvidence(
      listings,
      { goal: "balanced", budgetWei: 3n, maxAgeMs: 1000, purchasedIds: [] },
      now,
    ).chosen?.id,
    "a",
  );
  assert.equal(chooseRoute([], "quality").candidateId, null);
});
test("selection explains every rejection category and route uses purchased evidence", () => {
  const now = Date.now();
  const base = {
    candidateId: "x",
    title: "x",
    summary: "x",
    priceWei: 2n,
    observedAt: now,
    expiresAt: now + 1000,
    suiteVersion: "support-routing-v1",
    sampleCount: 32,
    provenance: "runner",
    commitment: "hash",
    status: "active" as const,
  };
  const listings = [
    { ...base, id: "p" },
    { ...base, id: "i", status: "sold" as const },
    { ...base, id: "b", priceWei: 9n },
    { ...base, id: "s", observedAt: now - 5000 },
    { ...base, id: "e", expiresAt: now - 1 },
  ];
  const out = selectEvidence(
    listings,
    { goal: "balanced", budgetWei: 3n, maxAgeMs: 1000, purchasedIds: ["p"] },
    now,
  );
  assert.match(out.decisions.find((x) => x.listingId === "p")!.reason, /already/);
  assert.match(out.decisions.find((x) => x.listingId === "i")!.reason, /inactive/);
  assert.match(out.decisions.find((x) => x.listingId === "b")!.reason, /budget/);
  assert.match(out.decisions.find((x) => x.listingId === "s")!.reason, /stale/);
  assert.match(out.decisions.find((x) => x.listingId === "e")!.reason, /stale/);
  const fast = createEvaluation("evalvault-demo-v1", "fast-keyword");
  const strong = createEvaluation("evalvault-demo-v1", "contextual-rules");
  assert.equal(chooseRoute([fast, strong], "quality").candidateId, "contextual-rules");
  assert.equal(chooseRoute([fast], "quality").candidateId, null);
});
test("report tampering is rejected", () => {
  const report = createEvaluation("demo-seed", "fast-keyword");
  report.cases[0].actual.queue = "escalate";
  assert.equal(validateReport(report).valid, false);
  assert.ok(validateReport(report).errors.some((e) => e.includes("output mismatch")));
});
test("report binding requires the demo suite and exact candidate config", () => {
  const report = createEvaluation("evalvault-demo-v1", "fast-keyword");
  for (const [field, value] of [
    ["suiteVersion", "other-suite"],
    ["candidateId", "unknown"],
    ["candidateConfig", "contextual-rules-v1"],
  ] as const) {
    const copy = structuredClone(report) as any;
    copy[field] = value;
    assert.equal(validateReport(copy).valid, false, field);
  }
  const arbitrary = createEvaluation("other-seed", "fast-keyword");
  assert.equal(validateReport(arbitrary).valid, false);
});
test("reports validate against an explicitly expected seed", () => {
  const report = createEvaluation("other-seed", "contextual-rules");
  assert.equal(validateReport(report).valid, false);
  assert.equal(validateReport(report, "other-seed").valid, true);
  const tampered = structuredClone(report);
  tampered.evaluationSeed = "evalvault-demo-v1";
  assert.equal(validateReport(tampered).valid, false);
  assert.equal(validateReport(tampered, "other-seed").valid, false);
});
test("report requires exactly the deterministic 32 cases and payloads", () => {
  const report = createEvaluation("evalvault-demo-v1", "contextual-rules");
  const duplicate = structuredClone(report);
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.equal(validateReport(duplicate).valid, false);
  const missing = structuredClone(report);
  missing.cases.pop();
  missing.sampleCount = 31;
  assert.equal(validateReport(missing).valid, false);
  const altered = structuredClone(report);
  altered.cases[0].input.body += " tampered";
  assert.equal(validateReport(altered).valid, false);
  const alteredExpected = structuredClone(report);
  alteredExpected.cases[0].expected.queue = "technical";
  assert.equal(validateReport(alteredExpected).valid, false);
});
test("latency, scores, and aggregate metrics must be finite and recomputed", () => {
  const report = createEvaluation("evalvault-demo-v1", "fast-keyword");
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const copy = structuredClone(report);
    copy.cases[0].latencyMs = value;
    assert.equal(validateReport(copy).valid, false);
  }
  const score = structuredClone(report);
  score.cases[0].correct = !score.cases[0].correct;
  assert.equal(validateReport(score).valid, false);
  const metrics = structuredClone(report);
  metrics.metrics.accuracy = 0;
  assert.equal(validateReport(metrics).valid, false);
});
test("an honest poor performing report remains valid", () => {
  const report = createEvaluation("evalvault-demo-v1", "fast-keyword");
  assert.equal(report.metrics.accuracy, 0.75);
  assert.equal(validateReport(report).valid, true);
});
test("policy tie breakers are total and deterministic", () => {
  const now = 1000;
  const base = {
    candidateId: "same",
    title: "x",
    summary: "x",
    priceWei: 2n,
    observedAt: now,
    expiresAt: 2000,
    suiteVersion: "support-routing-v1",
    sampleCount: 32,
    provenance: "runner",
    commitment: "hash",
    status: "active" as const,
  };
  const listings = [
    { ...base, id: "z" },
    { ...base, id: "a" },
  ];
  assert.equal(
    selectEvidence(
      listings,
      { goal: "balanced", budgetWei: 3n, maxAgeMs: 1000, purchasedIds: [] },
      now,
    ).chosen?.id,
    "a",
  );
  const fast = createEvaluation("evalvault-demo-v1", "fast-keyword");
  const strong = createEvaluation("evalvault-demo-v1", "contextual-rules");
  assert.equal(chooseRoute([strong, fast], "quality").candidateId, "contextual-rules");
});
test("seller pricing covers evaluation cost and applies a deterministic floor", () => {
  assert.equal(priceEvidence(800n, 2500, 1n), 1000n);
  assert.equal(priceEvidence(10n, 0, 50n), 50n);
  assert.throws(() => priceEvidence(1n, -1, 1n));
});
test("seller publishes missing coverage, refreshes changed terms, and holds fresh inventory", () => {
  const now = 10_000;
  const mandate = {
    candidateId: "contextual-rules",
    suiteVersion: "support-routing-v1",
    expectedTermsHash: "new",
    maxEvidenceAgeMs: 1_000,
    minimumShelfLifeMs: 500,
    evaluationCostWei: 800n,
    markupBps: 2500,
    minimumPriceWei: 500n,
  };
  assert.equal(planSellerListing([], mandate, now).action, "publish");
  const base = {
    candidateId: "contextual-rules",
    suiteVersion: "support-routing-v1",
    observedAt: 9_500,
    expiresAt: 20_000,
    termsHash: "new",
  };
  assert.equal(planSellerListing([base], mandate, now).action, "hold");
  assert.equal(planSellerListing([{ ...base, termsHash: "old" }], mandate, now).action, "refresh");
  assert.equal(planSellerListing([{ ...base, observedAt: 8_000 }], mandate, now).action, "refresh");
});
