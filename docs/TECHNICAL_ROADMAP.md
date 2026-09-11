# EvalVault technical roadmap

Build a working evidence market: seller agents publish private evaluations, a buyer buys useful evidence under a budget, on-chain escrow protects the exchange, and verified evidence changes a routing decision.

Status as of 2026-09-11: the application, interactive buyer workbench, escrow, private-evidence workflow, local-chain outcomes, public Base Sepolia deployment, and public hosting are implemented. The hosted workbench currently uses explicit simulation for a repeatable demonstration; the contract, two listings, successful settlement, and buyer refund are independently confirmed on Base Sepolia. The walkthrough video remains open. This file is the milestone record; only rows marked **Complete** are claims of completion.

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
| M4 | Durable API, private reveal, transaction recovery | **Complete** | Hashed bearer capabilities, commitment-bound runs, D1 locks and state, private R2 envelopes, report redaction, resumable steps, and signed transaction intents persisted before broadcast |
| M5 | Complete usable interface | **Complete** | Interactive Workshop-style three-pane UI; manual goal → catalogue selection → one-stage-at-a-time funding, evaluation, reveal, verification, acceptance, and withdrawal; refresh-safe resume; separate guided success/refund paths; commodity terms and buyer-value receipt |
| M6 | Integrated local validation | **Complete** | Full success and refund flows executed against a deployed Anvil contract with real signed transactions and reconciled receipts |
| M7 | Public testnet deployment | **Complete** | Base Sepolia escrow, two commitment-bound listings, successful delivery/payment/withdrawal, and evaluator-rejected buyer refund have confirmed receipts |
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
- Web quality: lint, strict TypeScript, and the final five-stage Vinext production build passed after receipt hardening and dependency upgrades. The deployment artifact contains the Worker entry point, static assets, hosting manifest, and all four D1 migrations. `npm audit` reports zero known vulnerabilities.
- Release security: the final independent audit found no release blocker or high-severity issue in the contract, live-mode controls, receipt binding, lock ownership, signer constraints, or private-report reveal path.
- Simulation API: the final smoke run completed success in 113 ms and refund in 42 ms, produced zero fake transaction hashes, rejected an unauthorized run read with 404, revealed the valid report only after delivery, and never revealed a report on refund.
- Deployment-transition privacy: with live configuration present and public spending disabled, new runs plus legacy-run reads and advances all returned 503. A simulation run whose stored listing commitment was replaced also returned 503 and exposed no report.
- Hosted release: `https://evalvault-evidence-market.lpsp.chatgpt.site` is public and returned HTTP 200 with a 111 ms observed first-byte time during release verification. Its explicit simulation catalog exposed no private fields; hosted success completed in 3,092 ms and hosted refund in 1,457 ms with zero transaction hashes.
- Hardened hosted release: commit `a3d564b` was published after the live-staging privacy fix. The fourth migration is active in hosted D1, the public page returned HTTP 200, and post-deploy success/refund smoke runs completed in explicit simulation with zero transaction hashes.
- WebMCP client: the public page advertised `run_evidence_purchase_demo` with the declared goal/scenario schema. An in-app client invocation completed run `ae4059a6-55a8-44b1-ab14-eeded162903c`, selected `contextual-rules`, and returned an explicit simulation result with zero transaction hashes.
- Interface refinement: the local browser exercised the paced success path through all seven visible stages in 3.20 seconds and the refund path through four stages in 1.55 seconds. The completed success receipt showed the 75% → 100% comparison, +25 percentage-point decision value, four verification checks, and 32/32 cases; the refund receipt showed a failed recomputation, returned funds, and no private case reveal.
- Refined hosted release: Sites version 3 deployed commit `db33835` successfully. The public page returned HTTP 200, the catalogue exposed the committed commodity terms with no private-field leak, success completed in 3,973 ms, and refund completed in 1,712 ms with zero fabricated transaction hashes. The public WebMCP tool then completed run `72340acb-c712-4a84-ad3e-12361ba5b493` and selected `contextual-rules` in explicit simulation mode.
- Interactive purchase validation: the local production UI advanced a selected valid dossier through `selected → funded → delivered → revealed → verified → accepted → complete`. It resumed a second purchase at `funded` after browser refresh, then followed `funded → refunded → complete` with no private sample reveal. API smoke retained guided success/refund coverage, rejected stale manual selection, exposed no private catalogue field or fault marker, and produced zero fabricated transaction hashes in simulation.
- Interactive public release: Sites version 5 deployed commits `1ed341f` and `68d0182` successfully. The public interactive smoke completed a guided success in 4,105 ms, a guided refund in 1,668 ms, and a manually selected market purchase in 1,863 ms; all ran in explicit simulation with zero fabricated transaction hashes. Public catalogue metadata uses neutral sealed-evaluation labels and does not disclose the refund fixture.
- Private-data check: the public catalog omits storage keys, fixture types, seeds, scores, cases, and latencies. Persisted run JSON was queried and contained no `evaluationSeed`; authorized responses hydrate the report from R2 only after the trace records `Evidence unlocked`.
- Post-hardening local success proof: Anvil order `3` completed in 156 ms with the route changed to `contextual-rules`. Funding `0x6cb5f93f8abd67a54818c3f7cbe5b0bfaef7df3568f360f62379f93786fd9ff4`, delivery `0x6fcf21462026de481d16cd77a8a66e3c1b2d5656865bb825153780de2433d81e`, release `0x219bd55f2e8afe3bab75db36deb884e827ba8a101400502b3080381b3b397472`, withdrawal `0xba6deab2f4afa6191976f353bcc30ae6de1a92ba0354178a29ee33d55910a7c4`.
- Post-hardening local refund proof: Anvil order `4` completed in 86 ms, returned the buyer credit, and exposed no report. Funding `0x6f1233615f8bfe4cc19d9abff5fb3622a3edd68a95e03e3d2ee90fd9942df41c`, evaluator refund `0x5b0eb974dfb0c179f161ff30c22ff1eaf1c705bd81eb93bd10acadf263978ef9`, withdrawal `0x0aff2f6018498162f9412675dd7eda3591c8318b2f336dc003d4ff760e4bc45b`.
- Scope label: every receipt above is from local Anvil chain ID 84532. None is represented as Base Sepolia or public-explorer proof.

## External dependencies

Still required from outside the codebase:

- One human-verified faucet claim for the prepared operator, followed by actor funding if the drip is under 0.005 test ETH. The exact public addresses and automated post-funding sequence are in `docs/BASE_SEPOLIA_HANDOFF.md`; keys already exist only in ignored local secret files.
- A human-recorded walkthrough of five minutes or less for the final submission. `docs/DEMO_SCRIPT.md` will provide the shot list.

Hosted-model credentials are optional because the submitted evidence is a real, deterministic, locally measured routing evaluation and is labeled as such. The public hosted demo will default to explicit simulation until constrained live-signing secrets are configured.

## Done

- Product research, vertical choice, threat model, architecture, and delivery plan.
- Native-ETH escrow with immutable listing terms, pinned evaluator, exact-price funding, request deduplication, delivery, acceptance, dispute, timeout, pull refunds, and pull seller withdrawals.
- Deterministic private evaluation, strict recomputation, policy selection, and a before/after routing decision.
- D1/R2 persistence, capability-token access, commitment-bound artifact hydration, live-staging maintenance gates, server-side report redaction, retry locks, transaction-intent recovery, receipt verification, spend cap, fixed chain/contract destinations, and a one-live-run-per-minute lease.
- Responsive Workshop-style buyer workbench, explicit simulation/live labeling, buyer-selected dossiers, one-stage-at-a-time persisted controls with refresh-safe resume, separate paced success/refund demos, standardized evidence access/delivery/refund terms, public policy-rejection reasons, integrity checks, before/after decision value, timing trace, and transaction links when live.
- Full local success and reject/refund journeys using a real deployed contract and real signed local transactions.

## Not done yet

- Move the protected hosted signer configuration through an owner-only staging pass before enabling a browser-triggered public testnet workflow. The public UI intentionally remains a simulation while that integration is closed.
- Record the short submission video.

## Progress log

- 2026-09-11 — Research and architecture: selected task-specific model-evaluation evidence as the vertical and documented the privacy, settlement, latency, and trust boundaries.
- 2026-09-11 — Contract/core: completed escrow hardening, deterministic evidence generation, strict validation, buyer policy, and tests.
- 2026-09-11 — Durable application: implemented the D1/R2 API, capability-gated reveal, resumable state machine, transaction intent journal, and operator catalog seeding.
- 2026-09-11 — Interface: completed the responsive evidence-purchase workbench, visible success/refund traces, decision output, and WebMCP tool registration.
- 2026-09-11 — Local live proof: deployed and seeded the escrow on Anvil, then completed both the seller-payment path and the invalid-artifact refund path. M6 moved to Complete.
- 2026-09-11 — Release hardening: added seller/expiry binding, sender and unique-event checks, owner-bound run locks, aggregate-credit receipt handling, honest local/simulation network labels, seller publish/refresh/hold policy, a reproducible local migration command, and dependency upgrades with a clean audit.
- 2026-09-11 — Public release: pushed the reviewed source to the public GitHub repository, published the Sites application, verified HTTP/catalog privacy, and completed both hosted simulation outcomes. M8 remains open only for the human-recorded video.
- 2026-09-11 — Testnet preparation: generated isolated operator, evaluator, and buyer actors into ignored `0600` files; verified chain ID 84532 and zero balances; kept live spending disabled; blocked free simulation access during live staging; bound runs to immutable artifact commitments; and documented the funding and automated release runbook. M7 moved to Ready for funding.
- 2026-09-11 — Final public hardening: pushed commit `a3d564b` to GitHub and Sites, verified the commitment-binding column in hosted D1, received HTTP 200, completed both post-deploy hosted smoke outcomes, and invoked the registered WebMCP tool from an actual client. Independent security review found no release blocker or high-severity issue.
- 2026-09-11 — Demo and design refinement: adopted the BlockTechnical Workshop shell with flatter panels, square borders, a restrained gold/cyan palette, simpler typography, progressive technical disclosure, and one primary action. Added paced simulation playback, scenario-aware catalogue ordering, replay, explicit non-exclusive usage and refund terms, public rejection reasons, a four-part evidence-value summary, an accuracy comparison, and accessible status/progress semantics. Local browser and API validation passed for success and refund.
- 2026-09-11 — Refined public release: published Sites version 3 from commit `db33835`, verified the public desktop and mobile presentation, completed both hosted API outcomes, checked catalogue redaction and commodity terms, and invoked the public WebMCP simulation through its client integration.
- 2026-09-11 — Interactive purchase release: made direct catalogue selection the default, added one-stage-at-a-time persisted purchase controls and resume behavior, separated the guided success/refund demo, and removed the catalogue marker that disclosed which sealed dossier would fail evaluation. M5 remains Complete; M7 remains Ready for funding and M8 remains open only for video.
- 2026-09-11 — Interactive public verification: deployed Sites version 5, confirmed the public catalogue and all three purchase paths, and synchronized legacy catalogue metadata without changing artifact commitments. The remaining submission action is the human-recorded walkthrough.
- 2026-09-11 — Public Base Sepolia proof: deployed the escrow at [`0x8cfe…699f`](https://sepolia.basescan.org/address/0x8cfeefb05e683b4a6dfd0163af42167c75e5699f) in [deployment `0x7ce7…ae45`](https://sepolia.basescan.org/tx/0x7ce75b93e9277550f31b194643650525d349ba3cff08b11cda7191dc6c40ae45), seeded [listing 1](https://sepolia.basescan.org/tx/0xc8e350937359a9e884b5f19ac0f00588d45481d11b437c6607619d7c2906831d) and [listing 2](https://sepolia.basescan.org/tx/0xe14a6ff9b2738569596bf99afc3e7de6816dd392fcb55769858cb286cb898193), and confirmed the complete [success settlement](https://sepolia.basescan.org/tx/0x3f8d9e6480016d5ea8b1fa06cc67937f9ea951c1a05f5d74fe2722d045911d73) plus [buyer refund](https://sepolia.basescan.org/tx/0x5be71566255c70023ce58b4d6d1b0f724242b757dc8f96d1b32ea4b42a1e7d97) paths. M7 moved to Complete.
