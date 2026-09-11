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

The checked-in [Base Sepolia deployment manifest](./deployments/base-sepolia.json) records the deployed contract and every listing, purchase, delivery, settlement, rejection, and refund transaction. Verify the chain ID, deployed bytecode, immutable configuration, receipt status, contract destination, and expected event logs directly from Base Sepolia with:

```sh
node scripts/verify-base-sepolia.mjs
```

## On-chain functionality

[`EvalVaultEscrow`](https://sepolia.basescan.org/address/0x8cfeefb05e683b4a6dfd0163af42167c75e5699f) is deployed on Base Sepolia. Every externally callable function that changes contract state has been executed on the public testnet:

| Contract function | On-chain behavior | Base Sepolia proof |
|---|---|---|
| `createListing` | Stores the seller, pinned evaluator, artifact commitment, terms hash, exact price, and expiry as an immutable offer | [Listings 1](https://sepolia.basescan.org/tx/0xc8e350937359a9e884b5f19ac0f00588d45481d11b437c6607619d7c2906831d) [and 2](https://sepolia.basescan.org/tx/0xe14a6ff9b2738569596bf99afc3e7de6816dd392fcb55769858cb286cb898193) |
| `buy` | Escrows the exact native-ETH price, freezes the listing terms into an order, records a unique buyer request ID, and starts the delivery deadline | [Funded order](https://sepolia.basescan.org/tx/0xfe180e018f6120294d00b4234740018500a0f4e768f317a834bd5202e6cd8ff9) |
| `markDelivered` | Lets only the pinned evaluator record the private-delivery receipt hash and start the review deadline | [Delivery](https://sepolia.basescan.org/tx/0xbad6c7be2a57ce407fac888180b3e802c4ee56f4b3a1f42a09a885fe03e41219) |
| `accept` | Lets only the buyer accept during review, moves the order to `Released`, and credits the seller | [Acceptance and release](https://sepolia.basescan.org/tx/0x910571a9163c882a22b03a79f2d2172aa0765855a64e5f069d95891b280a547a) |
| `reject` | Lets only the evaluator reject an invalid funded delivery, moves the order to `Refunded`, and credits the buyer | [Evaluator rejection](https://sepolia.basescan.org/tx/0x24be3434f64a0e2d6f6f23a2b1d37018baf923171cac2149c494be96896efdd2) |
| `challenge` | Lets only the buyer commit challenge-reason and private-evidence hashes during review and starts the resolution deadline | [Buyer challenge](https://sepolia.basescan.org/tx/0x9370ffbde93243bc6b006b5b7c34621134588272b4eecc9733448502b5959fbb) |
| `resolve` | Lets only the evaluator resolve a dispute to the seller or buyer before the deadline | [Seller outcome](https://sepolia.basescan.org/tx/0x6a4111c2edcf8d32f0b19ddaff67cf71511ba499d638b3f0dfe8cefe292fb861) · [buyer outcome](https://sepolia.basescan.org/tx/0xc13300e317f199fe9a9e87c0c3f43270ef67c706f6819e849adc47c626beda6a) |
| `refundUndelivered` | Refunds the buyer after the evaluator misses the delivery deadline | [Delivery-timeout refund](https://sepolia.basescan.org/tx/0x49379d4d968a205878e167d3d4a8ec5212b7e30e5e2b8e4eb60e95961f36a837) |
| `releaseAfterReview` | Releases an unchallenged delivery to the seller after the review deadline | [Review-timeout release](https://sepolia.basescan.org/tx/0xc5874f9ab0ef2c9bc187ffac4d2b50b47b240937d9d78a34190b2d860e3b2196) |
| `refundUnresolved` | Applies the buyer-friendly default when a dispute passes its resolution deadline | [Resolution-timeout refund](https://sepolia.basescan.org/tx/0x318ac6851e0be172ccb340153cb7ec2f2d0eb727a606cbd5c001abb974663ebe) |
| `withdraw` | Uses a reentrancy-guarded pull payment to transfer accumulated seller proceeds or buyer refunds and clear the corresponding credit | [Seller withdrawal](https://sepolia.basescan.org/tx/0x3f8d9e6480016d5ea8b1fa06cc67937f9ea951c1a05f5d74fe2722d045911d73) · [buyer withdrawal](https://sepolia.basescan.org/tx/0xeaaf61b459eabce6c70c448015f7a9a79ba7b2691ffc7fe219c3a9d86614b6ea) |

The read interface exposes the immutable evaluator and deadline configuration, individual listings and orders, used request IDs, account credits, and total escrow liabilities. Contract events provide an auditable record for every listing, funding, delivery, rejection, challenge, resolution, release, refund, and withdrawal. The verification command above confirms all 11 state-changing functions, 31 transactions, two stored listings, seven terminal orders, zero remaining liabilities, and zero unwithdrawn buyer or seller credit directly from Base Sepolia.

## Further reading

- [Technical roadmap](./docs/TECHNICAL_ROADMAP.md)
- [Demo script](./docs/DEMO_SCRIPT.md)
- [Base Sepolia handoff](./docs/BASE_SEPOLIA_HANDOFF.md)
- [Research, market analysis, threat model, and latency plan](./docs/BLACK_BOX_BAZAAR_PLAN.md)
