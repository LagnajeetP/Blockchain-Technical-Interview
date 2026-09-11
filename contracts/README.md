# EvalVaultEscrow

`EvalVaultEscrow` is a non-upgradeable native-ETH escrow for private evaluation
artifacts. A seller publishes a content commitment and terms hash. Buyers fund
independent orders at the exact listed price. One evaluator address, fixed at
deployment and copied into every listing and order, warrants delivery and resolves
objective disputes. The contract never receives artifact plaintext or private
dispute evidence. Buyers and sellers must trust that pinned evaluator to act
correctly and remain available; a compromised evaluator can falsely attest delivery
or choose the outcome of a dispute.

The three windows are fixed at deployment and must each be between 1 minute and 30
days. All ordinary actions use `block.timestamp < deadline`; the matching timeout
becomes available at `block.timestamp >= deadline`. A timed-out unresolved dispute
refunds the buyer. This buyer-friendly default can let a buyer retain a report for
free if the evaluator disappears during a dispute.

## State machine

```text
FUNDED -- markDelivered(evaluator) --> DELIVERED
FUNDED -- reject(evaluator) --------> REFUNDED
FUNDED -- refundUndelivered(anyone, at deadline) --> REFUNDED

DELIVERED -- accept(buyer) ---------> RELEASED
DELIVERED -- challenge(buyer) ------> DISPUTED
DELIVERED -- releaseAfterReview(anyone, at deadline) --> RELEASED

DISPUTED -- resolve(evaluator) -----> RELEASED or REFUNDED
DISPUTED -- refundUnresolved(anyone, at deadline) --> REFUNDED
```

Terminal transitions create pull-payment credits. `withdraw()` clears credit and
decreases liabilities before sending ETH, and is guarded against reentrancy. Failed
transfers revert the entire withdrawal, preserving the credit. There is no owner,
admin drain, upgrade proxy, token, arbitrary recipient, or fallback payment path.
The implementation uses a small two-state local reentrancy guard so this isolated
contract module has no package dependency; the adversarial withdrawal test verifies
that a nested `withdraw()` cannot spend the same credit twice.

## Constructor and ABI

```solidity
constructor(
    address evaluator_,
    uint64 deliveryWindow_,
    uint64 reviewWindow_,
    uint64 resolutionWindow_
)

function createListing(
    bytes32 artifactCommitment,
    bytes32 termsHash,
    uint256 price,
    uint64 expiresAt
) external returns (uint256 listingId);

function buy(uint256 listingId, bytes32 requestId)
    external payable returns (uint256 orderId);
function markDelivered(uint256 orderId, bytes32 receiptHash) external;
function reject(uint256 orderId, bytes32 reasonCodeHash) external;
function refundUndelivered(uint256 orderId) external;
function accept(uint256 orderId) external;
function challenge(
    uint256 orderId,
    bytes32 reasonCodeHash,
    bytes32 evidenceHash
) external;
function releaseAfterReview(uint256 orderId) external;
function resolve(uint256 orderId, bool refund, bytes32 decisionHash) external;
function refundUnresolved(uint256 orderId) external;
function withdraw() external;

function getListing(uint256 listingId) external view returns (Listing memory);
function getOrder(uint256 orderId) external view returns (Order memory);
function requestUsed(address buyer, bytes32 requestId) external view returns (bool);
function credits(address account) external view returns (uint256);
function totalLiabilities() external view returns (uint256);
function evaluator() external view returns (address);
function deliveryWindow() external view returns (uint64);
function reviewWindow() external view returns (uint64);
function resolutionWindow() external view returns (uint64);
function nextListingId() external view returns (uint256);
function nextOrderId() external view returns (uint256);
function MIN_WINDOW() external view returns (uint64);
function MAX_WINDOW() external view returns (uint64);
```

`Listing` returns `(seller, evaluator, artifactCommitment, termsHash, price,
expiresAt)`. `Order` returns `(listingId, buyer, seller, evaluator,
artifactCommitment, termsHash, requestId, price, deliveryDeadline, reviewDeadline,
resolutionDeadline, state, receiptHash, challengeReasonHash,
challengeEvidenceHash, decisionHash)`. `state` is the enum value `None=0`,
`Funded=1`, `Delivered=2`, `Disputed=3`, `Released=4`, or `Refunded=5`.
Sellers cannot buy their own listings. `RefundReason` identifies the path that
produced a refund: `EvaluatorRejected=0`, `DeliveryTimeout=1`, `ArbiterRefund=2`,
or `ResolutionTimeout=3`.

## Events

```solidity
event ListingCreated(
    uint256 indexed listingId,
    address indexed seller,
    address indexed evaluator,
    bytes32 artifactCommitment,
    bytes32 termsHash,
    uint256 price,
    uint64 expiresAt
);
event OrderFunded(
    uint256 indexed orderId,
    uint256 indexed listingId,
    address indexed buyer,
    address seller,
    address evaluator,
    bytes32 requestId,
    uint256 price,
    uint64 deliveryDeadline
);
event OrderDelivered(
    uint256 indexed orderId,
    bytes32 indexed receiptHash,
    uint64 reviewDeadline
);
event OrderRejected(uint256 indexed orderId, bytes32 indexed reasonCodeHash);
event OrderRefunded(
    uint256 indexed orderId,
    address indexed buyer,
    uint256 amount,
    RefundReason reason
);
event OrderAccepted(uint256 indexed orderId, address indexed buyer);
event OrderChallenged(
    uint256 indexed orderId,
    bytes32 indexed reasonCodeHash,
    bytes32 indexed evidenceHash,
    uint64 resolutionDeadline
);
event OrderResolved(
    uint256 indexed orderId,
    bool refunded,
    bytes32 indexed decisionHash
);
event OrderReleased(uint256 indexed orderId, address indexed seller, uint256 amount);
event Withdrawal(address indexed account, uint256 amount);
```

Reason codes, evidence references, evaluator decisions, receipts, commitments, and
terms are emitted or stored only as `bytes32` hashes. Callers should hash private
material locally and must never place plaintext evidence in transaction calldata.

## Tests

Run:

```sh
forge test -vv
```

The tests cover constructor bounds, immutable term/evaluator snapshots, exact native
payment, expired listings, per-buyer request deduplication, every authorized state
transition, unauthorized callers, complementary deadline boundaries, terminal-state
replay prevention, accumulated-credit withdrawal, forced ETH, accounting, a
recipient that rejects ETH, and an attempted reentrant double withdrawal. A
stateful invariant handler exercises successful funding, delivery, challenge,
settlement, timeout, and withdrawal sequences while checking that liabilities never
exceed the balance and every terminal order allocates its price exactly once. The
test suite is dependency-free and defines only the small Foundry cheatcode interface
it uses.

The central accounting property is `address(vault).balance >= totalLiabilities`.
Funding increases both values, terminal settlement moves the liability to exactly
one account without changing its total, and a successful withdrawal decreases both
by the same amount. Forced ETH can make the balance larger, so equality is not a
general invariant.
