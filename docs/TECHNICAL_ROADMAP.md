# EvalVault technical roadmap

Build a working evidence market: seller agents publish private evaluations, a buyer buys useful evidence under a budget, on-chain escrow protects the exchange, and verified evidence changes a routing decision.

Status as of 2026-09-11: the application, escrow, private-evidence workflow, and both local-chain outcomes are implemented. Public hosting and a funded Base Sepolia deployment remain open. This file is the milestone record; only rows marked **Complete** are claims of completion.

## Product decisions

- Differentiate through the full decision loop and falsifiable buyer protection, rather than claiming an unprecedented marketplace category.
- Show independent checks for report integrity, evaluation validity, and buyer usefulness.
- Default to Base Sepolia with native test ETH, one escrow contract, private evidence, and an explicitly trusted evaluator/referee.
- Use real measured local routing algorithms first. Hosted LLM evaluations are an optional adapter when credentials exist. Never label generated metrics or local algorithms as hosted model results.
- Host the application through Sites with durable D1/R2 storage and resumable HTTP-driven agent steps. This updates the original single-process hosting assumption to fit an available deployment path.
- Keep demonstrations, local-chain activity, public-testnet transactions, and proposed performance targets clearly distinguishable.

## Milestones

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| M0 | Recheck differentiation and freeze interfaces | **Complete** | 30-source research plan; product boundary, actors, privacy model, state machine, and schemas frozen |
| M1 | Scaffold, private configuration, local chain tooling | **Complete** | Vinext/Workers/D1/R2 app, Foundry project, local Anvil deployment, ignored local secrets, reproducible commands |
| M2 | Escrow and accounting | **Complete** | 24 passing Solidity tests, including success, all refund paths, replay guards, withdrawals, fuzzing, and 8,192 invariant calls |
| M3 | Real private evaluation and agent policies | **Complete** | 13 passing core tests; 32-case deterministic suite is recomputed; seller refresh/pricing and buyer stale, duplicate, eligibility, budget, and routing decisions are deterministic |
| M4 | Durable API, private reveal, transaction recovery | **Complete** | Hashed bearer capabilities, D1 locks and state, private R2 envelopes, report redaction, resumable steps, and signed transaction intents persisted before broadcast |
| M5 | Complete usable interface | **Complete** | Goal → selection → funding → reveal/verification → decision UI plus an explicit reject/refund path that never reveals the report |
| M6 | Integrated local validation | **Complete** | Full success and refund flows executed against a deployed Anvil contract with real signed transactions and reconciled receipts |
| M7 | Public testnet deployment | **Pending** | Requires funded Base Sepolia actors; no public address or explorer receipt is claimed yet |
| M8 | Public application and submission package | **In progress** | Public Sites release, public GitHub source, final README, deployment manifest, and demo script are complete; the recorded video remains |

## Execution ownership

The orchestration agent owns architecture, shared interfaces, integration, the hosted checkout, deployment, and security review. Lower-cost workers receive bounded contract, research, evidence, or documentation tasks. Workers run in waves within available concurrency limits; money-handling logic receives a separate integration review. No worker may silently change public schemas or publish credentials.

## Release gates

- Buyer cannot retrieve report plaintext before the required on-chain state.
- Correctly reported poor model performance is not grounds for refund.
- A terminal order cannot settle/refund twice; liabilities cannot exceed contract balance.
- A timed-out transaction is reconciled before another economic action is created.
- Agent spending and destinations are enforced in code; report text cannot authorize signing.
- Public endpoints cannot invoke an unrestricted signer or spend beyond the configured demo budget.
- Real testnet evidence is required to mark M7 complete. A local chain or simulated preview is insufficient.
- Build and meaningful tests must pass before release; outstanding external access is reported explicitly.

## Validation record

- Planning: `docs/BLACK_BOX_BAZAAR_PLAN.md` contains 30 primary or first-party source entries and was independently reviewed for differentiation, escrow ordering, latency accounting, and claims discipline.
- Smart contract: `forge fmt --check` and `forge build` passed. All 24 tests passed: 23 unit/fuzz tests plus one invariant suite with 64 runs × 128 calls = 8,192 calls and zero invariant-handler reverts.
- Evidence core: all 13 Node tests passed. The demo seed produces a measured 75% accuracy report for `fast-keyword` and 100% for `contextual-rules`; the verifier recomputes all 32 outputs, labels, correctness flags, finite timings, and aggregates. Seller tests cover cost-plus pricing and publish/refresh/hold decisions.
- Web quality: lint, strict TypeScript, and the final five-stage Vinext production build passed after receipt hardening and dependency upgrades. The deployment artifact contains the Worker entry point, static assets, hosting manifest, and all three D1 migrations. `npm audit` reports zero known vulnerabilities.
- Simulation API: the final smoke run completed success in 107 ms and refund in 39 ms, produced zero fake transaction hashes, rejected an unauthorized run read with 404, revealed the valid report only after delivery, and never revealed a report on refund.
- Hosted release: `https://evalvault-evidence-market.lpsp.chatgpt.site` is public and returned HTTP 200 with a 111 ms observed first-byte time during release verification. Its explicit simulation catalog exposed no private fields; hosted success completed in 3,092 ms and hosted refund in 1,457 ms with zero transaction hashes.
- Private-data check: the public catalog omits storage keys, fixture types, seeds, scores, cases, and latencies. Persisted run JSON was queried and contained no `evaluationSeed`; authorized responses hydrate the report from R2 only after the trace records `Evidence unlocked`.
- Post-hardening local success proof: Anvil order `3` completed in 156 ms with the route changed to `contextual-rules`. Funding `0x6cb5f93f8abd67a54818c3f7cbe5b0bfaef7df3568f360f62379f93786fd9ff4`, delivery `0x6fcf21462026de481d16cd77a8a66e3c1b2d5656865bb825153780de2433d81e`, release `0x219bd55f2e8afe3bab75db36deb884e827ba8a101400502b3080381b3b397472`, withdrawal `0xba6deab2f4afa6191976f353bcc30ae6de1a92ba0354178a29ee33d55910a7c4`.
- Post-hardening local refund proof: Anvil order `4` completed in 86 ms, returned the buyer credit, and exposed no report. Funding `0x6f1233615f8bfe4cc19d9abff5fb3622a3edd68a95e03e3d2ee90fd9942df41c`, evaluator refund `0x5b0eb974dfb0c179f161ff30c22ff1eaf1c705bd81eb93bd10acadf263978ef9`, withdrawal `0x0aff2f6018498162f9412675dd7eda3591c8318b2f336dc003d4ff760e4bc45b`.
- Scope label: every receipt above is from local Anvil chain ID 84532. None is represented as Base Sepolia or public-explorer proof.

## External dependencies

Still required from outside the codebase:

- Base Sepolia test ETH for the operator/evaluator and buyer accounts before M7 can produce public receipts. Keys must be supplied through local or hosted secrets, never chat or source control.
- A human-recorded walkthrough of five minutes or less for the final submission. `docs/DEMO_SCRIPT.md` will provide the shot list.

Hosted-model credentials are optional because the submitted evidence is a real, deterministic, locally measured routing evaluation and is labeled as such. The public hosted demo will default to explicit simulation until constrained live-signing secrets are configured.

## Done

- Product research, vertical choice, threat model, architecture, and delivery plan.
- Native-ETH escrow with immutable listing terms, pinned evaluator, exact-price funding, request deduplication, delivery, acceptance, dispute, timeout, pull refunds, and pull seller withdrawals.
- Deterministic private evaluation, strict recomputation, policy selection, and a before/after routing decision.
- D1/R2 persistence, capability-token access, server-side report redaction, retry locks, transaction-intent recovery, receipt verification, spend cap, fixed chain/contract destinations, and a one-live-run-per-minute lease.
- Responsive buyer workbench, explicit simulation/live labeling, success and refund scenarios, integrity checks, decision evidence, timing trace, and transaction links when live.
- Full local success and reject/refund journeys using a real deployed contract and real signed local transactions.

## Not done yet

- Deploy and seed the escrow on Base Sepolia; execute public success and refund receipts after wallets receive test ETH.
- Record the short submission video.
- Validate the registered WebMCP tool in a WebMCP-capable client. The visible UI and HTTP workflow are implemented; this client-level check has not been claimed.

## Progress log

- 2026-09-11 — Research and architecture: selected task-specific model-evaluation evidence as the vertical and documented the privacy, settlement, latency, and trust boundaries.
- 2026-09-11 — Contract/core: completed escrow hardening, deterministic evidence generation, strict validation, buyer policy, and tests.
- 2026-09-11 — Durable application: implemented the D1/R2 API, capability-gated reveal, resumable state machine, transaction intent journal, and operator catalog seeding.
- 2026-09-11 — Interface: completed the responsive evidence-purchase workbench, visible success/refund traces, decision output, and WebMCP tool registration.
- 2026-09-11 — Local live proof: deployed and seeded the escrow on Anvil, then completed both the seller-payment path and the invalid-artifact refund path. M6 moved to Complete.
- 2026-09-11 — Release hardening: added seller/expiry binding, sender and unique-event checks, owner-bound run locks, aggregate-credit receipt handling, honest local/simulation network labels, seller publish/refresh/hold policy, a reproducible local migration command, and dependency upgrades with a clean audit.
- 2026-09-11 — Public release: pushed the reviewed source to the public GitHub repository, published the Sites application, verified HTTP/catalog privacy, and completed both hosted simulation outcomes. M8 remains open only for the human-recorded video.
