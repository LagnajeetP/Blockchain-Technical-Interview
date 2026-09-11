# EvalVault demo script — 4 minutes 30 seconds

This is the recording checklist for the required walkthrough. The normal product path is the interactive workbench: the presenter selects a goal and sealed dossier, starts the purchase, and advances each persisted stage from the primary control. The guided success/refund experience and `run_evidence_purchase_demo` WebMCP invocation are separate repeatable demo paths. Do not show environment files, private keys, bearer tokens, the private evaluation seed, or terminal history containing secrets. Record the public application in a clean browser after the displayed mode and links have been verified.

## Before recording

- Confirm the app badge says exactly `simulation`, `local`, or `testnet`, matching the endpoint in use.
- For the final testnet recording, open the deployed contract and the prepared success/refund transaction links in separate tabs.
- Start on a fresh session so no purchased report is already visible.
- Use the primary interactive control for the main recording; reserve the guided WebMCP tool for a separate short integration shot if desired.
- Keep the browser wide enough to show the mandate, market, and execution trace together.
- Stop if any private case appears before `Evidence unlocked` or if a local hash is linked to Basescan.

## 0:00–0:35 — State the product and trust boundary

> EvalVault is a market where an application agent buys private evidence before choosing a routing model. Public listings reveal scope, freshness, price, provenance, and commitments. Scores, timings, and the 32 test cases stay sealed. The disclosed evaluator is trusted for test-set construction and delivery; the contract handles payment state.

Point to the mode badge. If it says `simulation`, say that this hosted run exercises the full durable workflow without claiming a public transaction. If it says `testnet`, open the contract link once and return to the app.

## 0:35–1:05 — Select public evidence

Choose **Quality** in the workbench. Briefly point to the access, settlement, delivery, and buyer-protection terms, then point out:

- the owned keyword-router evidence, rejected as already purchased;
- the stale contextual report, rejected on public metadata;
- the fresh sealed contextual report, still showing no score;
- the 0.000002 ETH spend cap and 90% accuracy floor.

> The buyer can reject claims before payment, but it cannot use the hidden score. I can choose between eligible dossiers using declared scope, freshness, sample count, price, and commitments; the server rechecks every policy rule before opening a run.

## 1:05–2:15 — Run the successful purchase

Keep **Interactive** selected, choose **sealed evaluation A**, and click **Start selected purchase**. Use the primary control once for each action: fund escrow, evaluate delivery, unlock evidence, verify evidence, accept evidence, and withdraw proceeds. Point out that each click changes only one durable protocol stage and the run can be resumed after refresh.

Call out the stages as they appear:

1. evidence gap detected;
2. exact-price escrow funded;
3. evaluator delivery attested;
4. evidence unlocked to the capability holder;
5. all cases and metrics recomputed;
6. buyer acceptance and seller withdrawal.

On the decision receipt, show the abstention before purchase and `contextual-rules` after verification. Point to the four-part evidence-value summary, the 75% → 100% comparison, +25 percentage-point lift, four integrity/provenance/terms/recomputation checks, 32/32 accuracy result, local-CPU timing label, and revealed sample rows.

If this is testnet, open one transaction link and show that its target is the documented escrow. If this is simulation, point to the zero-transaction count and explicit simulation label.

## 2:15–3:20 — Run the buyer-protection path

Switch to **Guided demo**, select **Invalid → refund**, and click **Run guided demo**. On public testnet, wait at least one minute after creating the prior live run because the server spend limiter admits one live run per minute.

> This scenario deliberately routes to a challenge dossier without exposing its defect in the public catalogue. The evaluator detects an output that does not recompute under the committed terms and rejects it before buyer reveal.

Show that:

- the trace reaches funded, evaluator rejection, refund credit, and buyer withdrawal;
- the final status is `refunded`;
- the decision remains unselected;
- no private sample rows appear;
- a truthful report with poor performance would still be payable.

If this is testnet, open the refund transaction and show the `OrderRefunded` event and withdrawal.

## 3:20–4:05 — Explain the mechanism

Use the interface and contract explorer rather than opening source files.

> Commitments prove byte integrity, deterministic recomputation proves conformance to the purchased suite, and the buyer’s changed route shows task-specific utility. None of those proves that the evaluator built an unbiased suite. The evaluator is pinned and disclosed, and unresolved disputes default to refund after a timeout.

Mention that transactions are signed only for the fixed Base Sepolia chain, configured escrow, allowlisted methods, and capped evidence value. A signed transaction intent is saved before broadcast, so retries reconcile the same hash instead of paying twice.

## 4:05–4:30 — Close with evidence and limitations

> The contract has 24 passing tests and 8,192 invariant-handler calls. The evidence core has 13 passing tests. Both settlement paths also completed against local Anvil with zero residual liabilities. The main limitation is that this prototype uses deterministic local routing candidates and a synthetic suite; its timing is not hosted-model latency, and test ETH is not evidence of market demand.

End on the public app with the repository, contract, and explorer links visible.

## Recording completion record

- Video URL: **Pending**
- Recorded mode: **Pending**
- Contract shown: **Pending**
- Success receipts shown: **Pending**
- Refund receipts shown: **Pending**
- Final duration: **Pending; must be 5:00 or less**
