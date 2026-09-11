# Base Sepolia release handoff

Status as of 2026-09-11: the actors are funded and the escrow is deployed at
[`0x8cfeefb05e683b4a6dfd0163af42167c75e5699f`](https://sepolia.basescan.org/address/0x8cfeefb05e683b4a6dfd0163af42167c75e5699f).
Two committed listings, a full successful settlement, and an evaluator-rejected
buyer refund have confirmed Base Sepolia receipts. Browser-triggered public live
runs remain disabled while the protected hosted signer configuration is staged.
No private key appears in this document or Git.

## Prepared actors

| Role | Address | Buffered target balance | Pays for |
|---|---|---:|---|
| Operator / seller | `0xD3313514dC2Ad0FC47dE3D5AD5e6B93a7ff836B8` | 0.003 test ETH | Contract deployment, two listings, seller withdrawal |
| Evaluator | `0xe878A893d35f99377dF133176409010F814a6246` | 0.001 test ETH | Delivery attestation and malformed-artifact rejection |
| Buyer | `0xF7E82A6C3d9D4915108884BAE926259b040C9a80` | 0.001 test ETH | Two purchases, acceptance, and refund withdrawal |

The targets include a wide gas buffer; they are not protocol minimums. The most
expensive evidence listing costs only `0.000001` test ETH, and the server refuses a
purchase above `0.000002` test ETH. Base Sepolia is chain ID `84532`.

Dedicated private keys and random operator/evaluation secrets exist only in the
ignored files `contracts/.env` and `web/.env.base-sepolia.local`, both with mode
`0600`. The generated web configuration has `PUBLIC_LIVE_RUNS_ENABLED=false`.
Running `npm run prepare:base-sepolia` again refuses to overwrite either file, so an
accidental rerun cannot silently rotate a funded actor.

## Historical funding note

Use the [QuickNode Base Sepolia faucet](https://faucet.quicknode.com/base/sepolia)
with the **operator address** above. Its current provider page says the base drip
requires no account, social post, or mainnet balance, but it does require human bot
verification. If the resulting operator balance covers the three target balances
**plus estimated distribution gas**, the operator can fund the other two actors. If
it does not, request a drip directly for the evaluator and buyer as well.

Never enter a seed phrase or private key into a faucet. Only the public address is
needed. These are valueless testnet funds; do not send mainnet ETH.

Other current primary-source options are Base's [Get Funds guide](https://docs.base.org/get-started/get-funds), the [Coinbase CDP faucet quickstart](https://docs.cdp.coinbase.com/faucets/introduction/quickstart), and the [Alchemy Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia). CDP requires a login or an API key for automation. Alchemy's no-login path requires at least 0.001 ETH on Ethereum mainnet plus sufficient mainnet activity. No documented anonymous faucet API was found. QuickNode may require interactive verification, and faucet eligibility, availability, and fulfillment are not guaranteed.

## Hosted live-mode release sequence

The remaining runbook is deterministic and owned by this project:

1. Recheck the three balances and distribute test ETH from the operator if needed.
2. Run `forge fmt --check`, `forge build`, and all contract tests again.
3. Simulate the deployment against `https://sepolia.base.org`, then broadcast it
   with the prepared operator and the 120-second delivery/review plus 300-second
   resolution windows.
4. Confirm chain ID, deployed bytecode, immutable evaluator, and constructor values;
   save the Basescan contract and deployment links.
5. Set the contract address and deployment block in both ignored environment files.
6. Temporarily set the hosted Site to owner-only access. Install the Base Sepolia
   values in hosted secrets while keeping public live runs disabled. The protected
   operator endpoint can seed both committed listings in this state, so catalog
   setup never requires opening buyer spending.
7. While access remains owner-only, enable the bounded live workflow, execute one
   valid delivery/release and one malformed-artifact refund, and capture every
   Basescan transaction link. The two runs are separated by the server's one-minute
   live-run lease.
8. Verify zero unexpected liabilities, no private report on the refund path, and no
   retained signed transaction payload. Update the README and roadmap with the
   public contract, listing, order, and settlement evidence, then restore public
   Site access for the recorded walkthrough.

During live staging the public run API returns `503`; it cannot fall back to a free
simulation over the paid catalog. Runs also store the selected artifact commitment,
so an older capability cannot hydrate a replacement listing version. Switching
back to simulation replaces any on-chain catalog rows before accepting new runs.

The public demo remains in explicit simulation mode until this sequence completes.
Local Anvil receipts remain useful integration evidence but are not substituted for
public Base Sepolia proof.
