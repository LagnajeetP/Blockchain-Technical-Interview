// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EvalVaultEscrow
/// @notice Native-ETH escrow for private evaluation artifacts adjudicated by a
///         disclosed evaluator. Artifact contents and dispute details remain
///         off-chain; only commitments and hashes are recorded here.
contract EvalVaultEscrow {
    uint64 public constant MIN_WINDOW = 1 minutes;
    uint64 public constant MAX_WINDOW = 30 days;

    enum OrderState {
        None,
        Funded,
        Delivered,
        Disputed,
        Released,
        Refunded
    }

    /// @notice The terminal path that allocated an order's price back to its buyer.
    enum RefundReason {
        EvaluatorRejected,
        DeliveryTimeout,
        ArbiterRefund,
        ResolutionTimeout
    }

    struct Listing {
        address seller;
        address evaluator;
        bytes32 artifactCommitment;
        bytes32 termsHash;
        uint256 price;
        uint64 expiresAt;
    }

    struct Order {
        uint256 listingId;
        address buyer;
        address seller;
        address evaluator;
        bytes32 artifactCommitment;
        bytes32 termsHash;
        bytes32 requestId;
        uint256 price;
        uint64 deliveryDeadline;
        uint64 reviewDeadline;
        uint64 resolutionDeadline;
        OrderState state;
        bytes32 receiptHash;
        bytes32 challengeReasonHash;
        bytes32 challengeEvidenceHash;
        bytes32 decisionHash;
    }

    error ZeroAddress();
    error InvalidWindow();
    error InvalidListing();
    error InvalidOrder();
    error EmptyHash();
    error InvalidPrice();
    error InvalidExpiration();
    error ListingExpired();
    error IncorrectPayment();
    error SelfPurchase();
    error DuplicateRequest();
    error Unauthorized();
    error InvalidState(OrderState expected, OrderState actual);
    error DeadlinePassed();
    error DeadlineNotReached();
    error NothingToWithdraw();
    error TransferFailed();
    error ReentrantCall();
    error TimestampOverflow();

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
        uint256 indexed orderId, bytes32 indexed receiptHash, uint64 reviewDeadline
    );
    event OrderRejected(uint256 indexed orderId, bytes32 indexed reasonCodeHash);
    event OrderRefunded(
        uint256 indexed orderId, address indexed buyer, uint256 amount, RefundReason reason
    );
    event OrderAccepted(uint256 indexed orderId, address indexed buyer);
    event OrderChallenged(
        uint256 indexed orderId,
        bytes32 indexed reasonCodeHash,
        bytes32 indexed evidenceHash,
        uint64 resolutionDeadline
    );
    event OrderResolved(uint256 indexed orderId, bool refunded, bytes32 indexed decisionHash);
    event OrderReleased(uint256 indexed orderId, address indexed seller, uint256 amount);
    event Withdrawal(address indexed account, uint256 amount);

    address public immutable evaluator;
    uint64 public immutable deliveryWindow;
    uint64 public immutable reviewWindow;
    uint64 public immutable resolutionWindow;

    uint256 public nextListingId = 1;
    uint256 public nextOrderId = 1;
    uint256 public totalLiabilities;

    mapping(uint256 => Listing) private _listings;
    mapping(uint256 => Order) private _orders;
    mapping(address => mapping(bytes32 => bool)) public requestUsed;
    mapping(address => uint256) public credits;

    uint256 private _locked = 1;

    constructor(
        address evaluator_,
        uint64 deliveryWindow_,
        uint64 reviewWindow_,
        uint64 resolutionWindow_
    ) {
        if (evaluator_ == address(0)) revert ZeroAddress();
        if (
            !_validWindow(deliveryWindow_) || !_validWindow(reviewWindow_)
                || !_validWindow(resolutionWindow_)
        ) {
            revert InvalidWindow();
        }

        evaluator = evaluator_;
        deliveryWindow = deliveryWindow_;
        reviewWindow = reviewWindow_;
        resolutionWindow = resolutionWindow_;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert ReentrantCall();
        _locked = 2;
        _;
        _locked = 1;
    }

    /// @notice Publishes a new immutable offer. Changed terms require a new listing.
    function createListing(
        bytes32 artifactCommitment,
        bytes32 termsHash,
        uint256 price,
        uint64 expiresAt
    ) external returns (uint256 listingId) {
        if (artifactCommitment == bytes32(0) || termsHash == bytes32(0)) {
            revert EmptyHash();
        }
        if (price == 0) revert InvalidPrice();
        if (expiresAt <= block.timestamp) revert InvalidExpiration();

        listingId = nextListingId++;
        _listings[listingId] = Listing({
            seller: msg.sender,
            evaluator: evaluator,
            artifactCommitment: artifactCommitment,
            termsHash: termsHash,
            price: price,
            expiresAt: expiresAt
        });

        emit ListingCreated(
            listingId, msg.sender, evaluator, artifactCommitment, termsHash, price, expiresAt
        );
    }

    /// @notice Funds an order at the listing's exact price.
    /// @dev requestId is deduplicated per buyer across all listings.
    function buy(uint256 listingId, bytes32 requestId) external payable returns (uint256 orderId) {
        Listing storage listing = _listings[listingId];
        if (listing.seller == address(0)) revert InvalidListing();
        if (msg.sender == listing.seller) revert SelfPurchase();
        if (block.timestamp >= listing.expiresAt) revert ListingExpired();
        if (requestId == bytes32(0)) revert EmptyHash();
        if (requestUsed[msg.sender][requestId]) revert DuplicateRequest();
        if (msg.value != listing.price) revert IncorrectPayment();

        requestUsed[msg.sender][requestId] = true;
        orderId = nextOrderId++;
        uint64 deadline = _deadline(deliveryWindow);

        Order storage order = _orders[orderId];
        order.listingId = listingId;
        order.buyer = msg.sender;
        order.seller = listing.seller;
        order.evaluator = listing.evaluator;
        order.artifactCommitment = listing.artifactCommitment;
        order.termsHash = listing.termsHash;
        order.requestId = requestId;
        order.price = msg.value;
        order.deliveryDeadline = deadline;
        order.state = OrderState.Funded;

        totalLiabilities += msg.value;
        emit OrderFunded(
            orderId,
            listingId,
            msg.sender,
            listing.seller,
            listing.evaluator,
            requestId,
            msg.value,
            deadline
        );
    }

    /// @notice Evaluator warrants that the committed artifact is privately retrievable.
    function markDelivered(uint256 orderId, bytes32 receiptHash) external {
        Order storage order = _orderInState(orderId, OrderState.Funded);
        _requireEvaluator(order);
        if (block.timestamp >= order.deliveryDeadline) revert DeadlinePassed();
        if (receiptHash == bytes32(0)) revert EmptyHash();

        order.receiptHash = receiptHash;
        order.reviewDeadline = _deadline(reviewWindow);
        order.state = OrderState.Delivered;
        emit OrderDelivered(orderId, receiptHash, order.reviewDeadline);
    }

    /// @notice Evaluator rejects an undelivered artifact and refunds the buyer.
    function reject(uint256 orderId, bytes32 reasonCodeHash) external {
        Order storage order = _orderInState(orderId, OrderState.Funded);
        _requireEvaluator(order);
        if (block.timestamp >= order.deliveryDeadline) revert DeadlinePassed();
        if (reasonCodeHash == bytes32(0)) revert EmptyHash();

        order.decisionHash = reasonCodeHash;
        emit OrderRejected(orderId, reasonCodeHash);
        _refund(orderId, order, RefundReason.EvaluatorRejected);
    }

    /// @notice Refunds an order if the evaluator missed the delivery deadline.
    function refundUndelivered(uint256 orderId) external {
        Order storage order = _orderInState(orderId, OrderState.Funded);
        if (block.timestamp < order.deliveryDeadline) revert DeadlineNotReached();
        _refund(orderId, order, RefundReason.DeliveryTimeout);
    }

    /// @notice Buyer accepts a delivered artifact during its review window.
    function accept(uint256 orderId) external {
        Order storage order = _orderInState(orderId, OrderState.Delivered);
        if (msg.sender != order.buyer) revert Unauthorized();
        if (block.timestamp >= order.reviewDeadline) revert DeadlinePassed();

        emit OrderAccepted(orderId, msg.sender);
        _release(orderId, order);
    }

    /// @notice Buyer opens the order's single dispute during the review window.
    function challenge(uint256 orderId, bytes32 reasonCodeHash, bytes32 evidenceHash) external {
        Order storage order = _orderInState(orderId, OrderState.Delivered);
        if (msg.sender != order.buyer) revert Unauthorized();
        if (block.timestamp >= order.reviewDeadline) revert DeadlinePassed();
        if (reasonCodeHash == bytes32(0) || evidenceHash == bytes32(0)) revert EmptyHash();

        order.challengeReasonHash = reasonCodeHash;
        order.challengeEvidenceHash = evidenceHash;
        order.resolutionDeadline = _deadline(resolutionWindow);
        order.state = OrderState.Disputed;
        emit OrderChallenged(orderId, reasonCodeHash, evidenceHash, order.resolutionDeadline);
    }

    /// @notice Releases an unchallenged order when its review window ends.
    function releaseAfterReview(uint256 orderId) external {
        Order storage order = _orderInState(orderId, OrderState.Delivered);
        if (block.timestamp < order.reviewDeadline) revert DeadlineNotReached();
        _release(orderId, order);
    }

    /// @notice Evaluator adjudicates a dispute before its resolution deadline.
    function resolve(uint256 orderId, bool refund, bytes32 decisionHash) external {
        Order storage order = _orderInState(orderId, OrderState.Disputed);
        _requireEvaluator(order);
        if (block.timestamp >= order.resolutionDeadline) revert DeadlinePassed();
        if (decisionHash == bytes32(0)) revert EmptyHash();

        order.decisionHash = decisionHash;
        emit OrderResolved(orderId, refund, decisionHash);
        if (refund) {
            _refund(orderId, order, RefundReason.ArbiterRefund);
        } else {
            _release(orderId, order);
        }
    }

    /// @notice Applies the buyer-friendly default if a dispute is not resolved.
    function refundUnresolved(uint256 orderId) external {
        Order storage order = _orderInState(orderId, OrderState.Disputed);
        if (block.timestamp < order.resolutionDeadline) revert DeadlineNotReached();
        _refund(orderId, order, RefundReason.ResolutionTimeout);
    }

    /// @notice Pulls the caller's accumulated proceeds/refunds.
    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        credits[msg.sender] = 0;
        totalLiabilities -= amount;
        (bool success,) = payable(msg.sender).call{ value: amount }("");
        if (!success) revert TransferFailed();

        emit Withdrawal(msg.sender, amount);
    }

    function getListing(uint256 listingId) public view returns (Listing memory) {
        Listing memory listing = _listings[listingId];
        if (listing.seller == address(0)) revert InvalidListing();
        return listing;
    }

    function getOrder(uint256 orderId) public view returns (Order memory) {
        Order memory order = _orders[orderId];
        if (order.state == OrderState.None) revert InvalidOrder();
        return order;
    }

    function _refund(uint256 orderId, Order storage order, RefundReason reason) private {
        order.state = OrderState.Refunded;
        credits[order.buyer] += order.price;
        emit OrderRefunded(orderId, order.buyer, order.price, reason);
    }

    function _release(uint256 orderId, Order storage order) private {
        order.state = OrderState.Released;
        credits[order.seller] += order.price;
        emit OrderReleased(orderId, order.seller, order.price);
    }

    function _orderInState(uint256 orderId, OrderState expected)
        private
        view
        returns (Order storage order)
    {
        order = _orders[orderId];
        if (order.state != expected) revert InvalidState(expected, order.state);
    }

    function _requireEvaluator(Order storage order) private view {
        if (msg.sender != order.evaluator) revert Unauthorized();
    }

    function _deadline(uint64 window) private view returns (uint64) {
        uint256 deadline = block.timestamp + window;
        if (deadline > type(uint64).max) revert TimestampOverflow();
        return uint64(deadline);
    }

    function _validWindow(uint64 window) private pure returns (bool) {
        return window >= MIN_WINDOW && window <= MAX_WINDOW;
    }
}
