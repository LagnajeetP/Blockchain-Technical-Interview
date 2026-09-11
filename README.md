# EvalVault · The Black Box Bazaar

EvalVault is an evidence marketplace for autonomous decision systems. A buyer purchases a sealed, task-specific model-evaluation dossier, verifies it against its committed terms, and uses the evidence to make a routing decision.

**Live application:** [evalvault-evidence-market.lpsp.chatgpt.site](https://evalvault-evidence-market.lpsp.chatgpt.site)

**Source:** [github.com/LagnajeetP/Blockchain-Technical-Interview](https://github.com/LagnajeetP/Blockchain-Technical-Interview)

## What it does

- Publishes private 32-case routing evaluations as sealed, priced dossiers.
- Lets the buyer reject stale, duplicate, under-covered, or over-budget listings before payment.
- Supports a buyer-selected, step-by-step purchase flow: fund, evaluate, unlock, verify, accept, and withdraw.
- Reveals private evidence only after the entitled delivery state.
- Recomputes every purchased case and metric before the buyer changes its routing decision.
- Refunds the buyer when a dossier fails its byte, commitment, schema, terms, or recomputation checks.
- Persists runs, capability-token hashes, locks, receipts, and transaction intents for safe recovery after refresh or retries.

## Product flow

```text
Public metadata → buyer policy → exact-price escrow
                                      │
                    evaluator validates delivery
                         ┌────────────┴────────────┐
                         │                         │
                  invalid artifact            valid artifact
                         │                         │
                  refund + withdrawal      private reveal + recomputation
                                                   │
                                         accept + seller withdrawal
```

Public listings contain task scope, coverage, freshness, price, provenance, and commitments. Test cases, outputs, scores, and latency distributions remain private until authorized delivery.

## Try it

1. Open the [hosted application](https://evalvault-evidence-market.lpsp.chatgpt.site).
2. Keep **Interactive** selected and choose a goal.
3. Select an eligible sealed dossier.
4. Start the purchase, then advance one persisted step at a time.
5. Review the decision receipt, verification checks, and revealed evidence.
6. Switch to **Guided demo** and run **Invalid → refund** to see buyer protection without private-case disclosure.

The public application currently presents the complete interaction in explicit simulation mode. The underlying escrow is deployed on Base Sepolia at [`0x8cfe…699f`](https://sepolia.basescan.org/address/0x8cfeefb05e683b4a6dfd0163af42167c75e5699f), with two committed listings and confirmed successful-settlement and refund journeys. The protected hosted signer configuration remains disabled while the public demo uses simulation. See the [Base Sepolia handoff](./docs/BASE_SEPOLIA_HANDOFF.md) for the release sequence.

## Design choices

| Decision | Why it matters |
|---|---|
| Evidence is the commodity | Buyers pay for decision-relevant evaluations, not vague model claims. |
| Private delivery, public settlement | The product remains private while commitments and settlement remain auditable. |
| Pinned evaluator | Delivery and objective disputes have an accountable, disclosed referee. |
| Deterministic recomputation | Buyers verify the full purchased report instead of trusting a dashboard score. |
| Pull payments and request IDs | Settlement is replay-resistant and avoids forced transfers. |
| Persist-before-broadcast intents | Retries reconcile a single signed transaction instead of creating duplicate spending. |
| Manual stages plus guided demo | The product is inspectable for buyers and repeatable for demonstrations. |

## Architecture

```text
React / Vinext workbench + WebMCP
              │
Cloudflare Worker API
  ├─ D1: catalogue, runs, locks, receipts, transaction intents
  ├─ R2: private evidence envelopes
  ├─ buyer policy + deterministic verifier
  └─ constrained signer: fixed chain, contract, methods, and value cap
              │
       EvalVaultEscrow.sol
```

The evaluator and storage operator are explicitly trusted to construct and preserve the private test set fairly. Commitments prove delivered bytes, and recomputation proves conformance to the declared evaluation; neither alone proves that a private suite is unbiased or predictive of production traffic.

## Run locally

Requirements: Node.js `>=22.13.0`, npm, and [Foundry](https://getfoundry.sh/).

```sh
cd web
cp .dev.vars.example .dev.vars
npm ci
npm run build
npm run db:local
npm run dev
```

Open `http://localhost:3000`.

```sh
cd web
npm run test:core
npm run lint
npx tsc --noEmit --incremental false
npm run test:api

cd ../contracts
make build
make test
```

## Verification

- **24 Solidity tests** covering success, refund paths, replay guards, withdrawals, fuzzing, and an 8,192-call invariant campaign.
- **13 evidence and policy tests** covering strict recomputation, tampering, stale and duplicate rejection, budget enforcement, routing, and seller refresh/pricing policy.
- Full successful and refund journeys completed with real signed transactions on a local Anvil deployment.
- Public interactive, guided-success, and guided-refund flows verified on the hosted release with no fabricated transaction hashes and no private catalogue fields.

## Status

| Area | Current status |
|---|---|
| Interactive hosted workbench | Live |
| Buyer policy, private delivery, verification, refunds | Live in explicit simulation |
| Escrow contract and local signed integration | Complete |
| Public Base Sepolia contract and receipts | Pending faucet funding |
| Walkthrough video | Ready to record using the [demo script](./docs/DEMO_SCRIPT.md) |

## Further reading

- [Technical roadmap](./docs/TECHNICAL_ROADMAP.md)
- [Demo script](./docs/DEMO_SCRIPT.md)
- [Base Sepolia handoff](./docs/BASE_SEPOLIA_HANDOFF.md)
- [Research, market analysis, threat model, and latency plan](./docs/BLACK_BOX_BAZAAR_PLAN.md)
