# EvalVault · The Black Box Bazaar

EvalVault is a marketplace where autonomous agents trade **private, task-specific model-evaluation evidence**. The first vertical is customer-support routing: a buyer has an uncertain routing decision, purchases one sealed 32-case dossier, verifies every result, and either chooses a candidate or abstains.

**Hosted demo:** [evalvault-evidence-market.lpsp.chatgpt.site](https://evalvault-evidence-market.lpsp.chatgpt.site) · **Source:** [github.com/LagnajeetP/Blockchain-Technical-Interview](https://github.com/LagnajeetP/Blockchain-Technical-Interview)

The hosted demo is deliberately labeled **simulation** until funded Base Sepolia signers are configured. The same workflow has completed both settlement outcomes with real signed transactions against a local Anvil deployment. Public-testnet receipts remain an explicit release item in the [technical roadmap](./docs/TECHNICAL_ROADMAP.md).

## What the agents do

- The **seller/catalog agent** generates or refreshes deterministic evaluation dossiers, stores their exact bytes in private R2 storage, commits to the artifact and terms, prices them, and publishes a safe metadata projection. The bundled sellers are disclosed fixtures operated by the project owner, rather than independent market participants.
- The **buyer agent** detects an evidence gap, rejects owned or stale listings, enforces its budget, ranks eligible public claims, funds one purchase, retrieves the authorized artifact, recomputes it, and changes its routing decision only if the evidence meets the chosen floor.
- The **evaluator** is a disclosed, pinned referee. It attests delivery or rejects malformed evidence and adjudicates objective disputes.
- `EvalVaultEscrow` holds native ETH until a release or refund becomes final.

The default interface is an interactive buyer workbench: choose a goal, inspect the public catalogue and terms, select a sealed dossier, and start a purchase. Each control advances exactly one persisted stage, from escrow funding through evaluation, reveal, recomputation, acceptance, and withdrawal. The receipt shows the before/after routing decision, and a refresh resumes the same capability-gated run. In the current hosted release the controls run against the explicit simulation backend; once the funded Base Sepolia configuration is installed, the same interaction drives bounded live transactions. If a selected dossier fails its committed terms, the evaluator refunds the buyer without revealing private cases.

The separate guided demo path is the registered `run_evidence_purchase_demo` WebMCP tool. It is useful for a repeatable walkthrough or client integration, but it does not replace the interactive workbench or change the hosted release's current simulation status.

## Public claims and paid evidence

| Public before purchase | Private until the entitled delivery state |
|---|---|
| Candidate and task scope | Evaluation seed and complete test inputs |
| Suite version, sample count, and non-exclusive usage terms | Expected and actual outputs |
| Price, freshness, expiry, and provenance tier | Per-case correctness and failure examples |
| Artifact and terms commitments | Accuracy and measured latency distribution |

The prototype treats evidence as a defined information commodity: access is non-exclusive and limited to internal evaluation, redistribution is not granted, delivery follows evaluator approval, and objective byte, commitment, schema, or recomputation failure triggers a refund. These terms are included in the committed purchase terms rather than presented as decorative marketplace metadata.

The catalog API removes the object key, fixture type, seed, cases, scores, and timings. A random capability is returned once when a run starts; D1 stores only its SHA-256 digest. The authorized response reads the report from R2 only after the workflow records `Evidence unlocked`, and persisted run JSON never contains the report.

## Purchase and protection mechanism

```text
public selection → exact-price FUNDED → evaluator inspection
                                  ├─ malformed → REFUNDED → buyer withdraws
                                  └─ valid → DELIVERED → private reveal → recompute
                                                        ├─ accept → RELEASED → seller withdraws
                                                        └─ challenge → evaluator or timeout resolution
```

The contract also permits delivery-timeout refunds, buyer challenges, evaluator resolution, unresolved-dispute refunds, and permissionless release after an unchallenged review window. Terminal transitions create pull-payment credits. Request IDs prevent duplicate purchases; immutable order snapshots prevent later listing changes from rewriting a purchase.

The biggest design decision is to separate **private delivery** from **public settlement**. The chain records commitments, terms, actors, deadlines, and money movement. The full dossier stays off-chain. This avoids publishing the product being sold while keeping payment outcomes independently observable.

## Trust boundary and important limitation

Four claims remain separate:

1. a commitment proves the delivered bytes match the listed bytes;
2. deterministic recomputation proves those bytes satisfy the declared suite and arithmetic;
3. the evaluator identity establishes who attested the run;
4. the changed routing decision demonstrates usefulness for this buyer policy.

The evaluator and storage operator are still trusted to construct the private suite honestly, preserve the artifact, and act on time. A matching hash cannot prove that observations were unbiased or predict future production behavior.

The most important product limitation is that this prototype evaluates two deterministic local routing implementations on a synthetic support suite. Timings are real local synchronous CPU observations, but they are neither hosted-model latency nor a production guarantee. Test ETH also does not prove economic demand.

## Architecture

```text
React/Vinext workbench + WebMCP tool
                 │
        Cloudflare Worker API
          ├─ D1: catalog, runs, locks, receipts, transaction intents
          ├─ R2: private evaluation envelopes
          ├─ buyer selection + deterministic verifier
          └─ constrained viem signer: fixed chain, contract, methods, value cap
                 │
          EvalVaultEscrow.sol
```

Each live transaction is simulated and signed, then its hash and serialized payload are durably stored **before** broadcast. A retry reconciles that exact intent and receipt before another economic action. Confirmed intents erase the signed payload. Run updates use owner-bound compare-and-swap locks so an expired worker cannot overwrite newer state. A run is bound to the selected artifact commitment; live staging disables public runs instead of falling back to free simulation over the paid catalog.

## Run locally

Requirements: Node.js `>=22.13.0`, npm, and [Foundry](https://github.com/foundry-rs/foundry) for Solidity checks.

```sh
cd web
cp .dev.vars.example .dev.vars
npm ci
npm run build
npm run db:local
npm run dev
```

Open `http://localhost:3000`, choose a goal and an eligible dossier, then advance the purchase through its visible stages. Switch to **Guided demo** for the paced success/refund walkthrough. In another terminal, validate the explicit simulation API:

```sh
cd web
npm run test:core
npm run lint
npx tsc --noEmit --incremental false
npm run test:api
```

Run the escrow suite separately:

```sh
cd contracts
make build
make test
```

Live local or Base Sepolia configuration is described in [`web/.env.example`](./web/.env.example) and [`contracts/DEPLOYMENT.md`](./contracts/DEPLOYMENT.md). The prepared actor addresses, current funding state, and exact post-funding release sequence are in the [`Base Sepolia handoff`](./docs/BASE_SEPOLIA_HANDOFF.md). Never commit `.dev.vars`, `.env`, private keys, bearer tokens, or the private evaluation seed.

## Verified evidence so far

- Solidity: **24 passing tests**; the invariant campaign executed **8,192 handler calls** with no handler revert.
- Evaluation/policy: **13 passing tests** covering exact recomputation, tampering, seed/config/suite binding, stale/duplicate/budget rejection, deterministic buyer selection, seller refresh/pricing policy, and honest poor performance.
- Post-hardening local-chain success: order `3`, four signed transactions, route changed to `contextual-rules`, zero remaining escrow liability.
- Post-hardening local-chain refund: order `4`, three signed transactions, malformed report rejected, no report exposed, zero remaining escrow liability.
- Persistence audit: 16/16 transaction intents confirmed, zero signed payloads retained, zero active run locks, and zero stored seed leaks.
- Public WebMCP: the registered `run_evidence_purchase_demo` tool was discovered and invoked from an in-app client; its quality/success run selected `contextual-rules` and returned zero transaction hashes in explicit simulation mode.

These transaction hashes are recorded in the [roadmap](./docs/TECHNICAL_ROADMAP.md) and are explicitly local Anvil evidence. They are not presented as public Base Sepolia proof.

## Submission status

| Deliverable | Status |
|---|---|
| Vertical, agents, mechanism, trust model | Complete |
| Contract, application, success path, refund path | Complete |
| Local real-transaction integration | Complete |
| Public GitHub repository | Complete |
| Hosted interactive demo | Complete and publicly accessible; currently explicit simulation |
| Base Sepolia contract and explorer receipts | Actors/config prepared; pending faucet funding |
| Walkthrough video ≤5 minutes | Pending recording; use the [demo script](./docs/DEMO_SCRIPT.md) |

## Research basis

The design follows controlled multi-metric evaluation principles from [Stanford HELM](https://crfm.stanford.edu/2022/11/17/helm.html), explicit evaluation records and scoring from the UK AISI’s [Inspect logs](https://inspect.aisi.org.uk/eval-logs.html) and [scorers](https://inspect.aisi.org.uk/scoring.html), and private benchmarking motivation from [TRUCE](https://arxiv.org/abs/2403.00393). The mechanism choices use Base’s [network/RPC documentation](https://docs.base.org/base-chain/api-reference/rpc-overview), Solidity’s [withdrawal and Checks-Effects-Interactions guidance](https://docs.soliditylang.org/en/latest/security-considerations.html), viem’s [receipt reconciliation behavior](https://viem.sh/docs/actions/public/waitForTransactionReceipt), Cloudflare’s [D1 model](https://developers.cloudflare.com/workers/platform/storage-options/) and [private-by-default R2 buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/), and Foundry’s [stateful invariant testing](https://getfoundry.sh/forge/invariant-testing).

The full product comparison, 30-source evidence record, threat model, latency budget, and rejected alternatives are in [`docs/BLACK_BOX_BAZAAR_PLAN.md`](./docs/BLACK_BOX_BAZAAR_PLAN.md). Completed and open work is tracked without conflating local, simulated, and public evidence in [`docs/TECHNICAL_ROADMAP.md`](./docs/TECHNICAL_ROADMAP.md).
