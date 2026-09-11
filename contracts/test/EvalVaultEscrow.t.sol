// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EvalVaultEscrow } from "../src/EvalVaultEscrow.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 revertData) external;
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
}

struct FuzzSelector {
    address addr;
    bytes4[] selectors;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool value) internal pure {
        require(value, "assertTrue failed");
    }

    function assertFalse(bool value) internal pure {
        require(!value, "assertFalse failed");
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "uint mismatch");
    }

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "address mismatch");
    }

    function assertEq(bytes32 actual, bytes32 expected) internal pure {
        require(actual == expected, "bytes32 mismatch");
    }
}

contract EvalVaultEscrowTest is TestBase {
    event OrderRejected(uint256 indexed orderId, bytes32 indexed reasonCodeHash);
    event OrderRefunded(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 amount,
        EvalVaultEscrow.RefundReason reason
    );
    event OrderResolved(uint256 indexed orderId, bool refunded, bytes32 indexed decisionHash);

    address internal constant EVALUATOR = address(0xE11A);
    address internal constant SELLER = address(0x5E11E2);
    address internal constant BUYER = address(0xB0B);
    address internal constant OTHER = address(0xCA11);

    uint64 internal constant DELIVERY_WINDOW = 2 minutes;
    uint64 internal constant REVIEW_WINDOW = 3 minutes;
    uint64 internal constant RESOLUTION_WINDOW = 5 minutes;
    uint256 internal constant PRICE = 0.04 ether;
    bytes32 internal constant ARTIFACT = keccak256("artifact");
    bytes32 internal constant TERMS = keccak256("terms-v1");
    bytes32 internal constant RECEIPT = keccak256("receipt");
    bytes32 internal constant REASON = keccak256("schema-invalid");
    bytes32 internal constant EVIDENCE = keccak256("private-evidence");
    bytes32 internal constant DECISION = keccak256("decision");

    EvalVaultEscrow internal vault;
    uint256 internal listingId;

    function setUp() public {
        vault = new EvalVaultEscrow(EVALUATOR, DELIVERY_WINDOW, REVIEW_WINDOW, RESOLUTION_WINDOW);
        vm.prank(SELLER);
        listingId = vault.createListing(ARTIFACT, TERMS, PRICE, uint64(block.timestamp + 10 days));
        vm.deal(BUYER, 10 ether);
        vm.deal(OTHER, 10 ether);
    }

    function testConstructorRejectsUnsafeConfiguration() public {
        vm.expectRevert(EvalVaultEscrow.ZeroAddress.selector);
        new EvalVaultEscrow(address(0), 1 minutes, 1 minutes, 1 minutes);

        vm.expectRevert(EvalVaultEscrow.InvalidWindow.selector);
        new EvalVaultEscrow(EVALUATOR, 59 seconds, 1 minutes, 1 minutes);

        vm.expectRevert(EvalVaultEscrow.InvalidWindow.selector);
        new EvalVaultEscrow(EVALUATOR, 1 minutes, 31 days, 1 minutes);
    }

    function testListingAndOrderFreezeTermsAndEvaluator() public {
        EvalVaultEscrow.Listing memory listing = vault.getListing(listingId);
        assertEq(listing.seller, SELLER);
        assertEq(listing.evaluator, EVALUATOR);
        assertEq(listing.artifactCommitment, ARTIFACT);
        assertEq(listing.termsHash, TERMS);
        assertEq(listing.price, PRICE);

        uint256 orderId = _buy(BUYER, bytes32("freeze"));
        EvalVaultEscrow.Order memory order = vault.getOrder(orderId);
        assertEq(order.listingId, listingId);
        assertEq(order.buyer, BUYER);
        assertEq(order.seller, SELLER);
        assertEq(order.evaluator, EVALUATOR);
        assertEq(order.artifactCommitment, ARTIFACT);
        assertEq(order.termsHash, TERMS);
        assertEq(order.price, PRICE);
        assertEq(uint256(order.state), uint256(EvalVaultEscrow.OrderState.Funded));
        assertEq(vault.totalLiabilities(), PRICE);
        assertEq(address(vault).balance, PRICE);
    }

    function testCreateListingRejectsEmptyOrExpiredTerms() public {
        vm.startPrank(SELLER);
        vm.expectRevert(EvalVaultEscrow.EmptyHash.selector);
        vault.createListing(bytes32(0), TERMS, PRICE, uint64(block.timestamp + 1));
        vm.expectRevert(EvalVaultEscrow.EmptyHash.selector);
        vault.createListing(ARTIFACT, bytes32(0), PRICE, uint64(block.timestamp + 1));
        vm.expectRevert(EvalVaultEscrow.InvalidPrice.selector);
        vault.createListing(ARTIFACT, TERMS, 0, uint64(block.timestamp + 1));
        vm.expectRevert(EvalVaultEscrow.InvalidExpiration.selector);
        vault.createListing(ARTIFACT, TERMS, PRICE, uint64(block.timestamp));
        vm.stopPrank();
    }

    function testBuyRequiresLiveListingAndExactNativePayment() public {
        vm.prank(BUYER);
        vm.expectRevert(EvalVaultEscrow.IncorrectPayment.selector);
        vault.buy{ value: PRICE - 1 }(listingId, bytes32("underpay"));

        vm.prank(BUYER);
        vm.expectRevert(EvalVaultEscrow.IncorrectPayment.selector);
        vault.buy{ value: PRICE + 1 }(listingId, bytes32("overpay"));

        vm.warp(block.timestamp + 10 days);
        vm.prank(BUYER);
        vm.expectRevert(EvalVaultEscrow.ListingExpired.selector);
        vault.buy{ value: PRICE }(listingId, bytes32("expired"));
    }

    function testSellerCannotBuyOwnListing() public {
        bytes32 requestId = bytes32("self-purchase");
        vm.deal(SELLER, PRICE);
        vm.prank(SELLER);
        vm.expectRevert(EvalVaultEscrow.SelfPurchase.selector);
        vault.buy{ value: PRICE }(listingId, requestId);

        assertFalse(vault.requestUsed(SELLER, requestId));
        assertEq(vault.totalLiabilities(), 0);
    }

    function testRequestIdDeduplicatesPerBuyerAcrossListings() public {
        bytes32 requestId = bytes32("same-request");
        _buy(BUYER, requestId);

        vm.prank(SELLER);
        uint256 secondListing = vault.createListing(
            keccak256("artifact-2"), keccak256("terms-2"), PRICE, uint64(block.timestamp + 10 days)
        );

        vm.prank(BUYER);
        vm.expectRevert(EvalVaultEscrow.DuplicateRequest.selector);
        vault.buy{ value: PRICE }(secondListing, requestId);

        vm.prank(OTHER);
        vault.buy{ value: PRICE }(secondListing, requestId);
        assertTrue(vault.requestUsed(BUYER, requestId));
        assertTrue(vault.requestUsed(OTHER, requestId));
        assertEq(vault.totalLiabilities(), PRICE * 2);
    }

    function testOnlyPinnedEvaluatorCanDeliverBeforeDeadline() public {
        uint256 orderId = _buy(BUYER, bytes32("deliver"));

        vm.prank(OTHER);
        vm.expectRevert(EvalVaultEscrow.Unauthorized.selector);
        vault.markDelivered(orderId, RECEIPT);

        vm.prank(EVALUATOR);
        vault.markDelivered(orderId, RECEIPT);

        EvalVaultEscrow.Order memory order = vault.getOrder(orderId);
        assertEq(uint256(order.state), uint256(EvalVaultEscrow.OrderState.Delivered));
        assertEq(order.receiptHash, RECEIPT);
        assertEq(order.reviewDeadline, uint64(block.timestamp + REVIEW_WINDOW));
    }

    function testDeliveryDeadlineBoundaryBelongsToTimeout() public {
        uint256 orderId = _buy(BUYER, bytes32("delivery-boundary"));
        uint64 deadline = vault.getOrder(orderId).deliveryDeadline;
        vm.warp(deadline);

        vm.prank(EVALUATOR);
        vm.expectRevert(EvalVaultEscrow.DeadlinePassed.selector);
        vault.markDelivered(orderId, RECEIPT);

        vm.prank(OTHER);
        vm.expectEmit(true, true, false, true, address(vault));
        emit OrderRefunded(orderId, BUYER, PRICE, EvalVaultEscrow.RefundReason.DeliveryTimeout);
        vault.refundUndelivered(orderId);
        _assertCredited(orderId, EvalVaultEscrow.OrderState.Refunded, BUYER);
    }

    function testFuzzDeliverySucceedsAtEverySecondBeforeDeadline(uint8 rawSecondsBefore) public {
        uint256 orderId = _buy(BUYER, bytes32("fuzz-delivery"));
        uint64 deadline = vault.getOrder(orderId).deliveryDeadline;
        uint256 secondsBefore = (uint256(rawSecondsBefore) % DELIVERY_WINDOW) + 1;
        vm.warp(deadline - secondsBefore);

        vm.prank(EVALUATOR);
        vault.markDelivered(orderId, RECEIPT);
        assertEq(
            uint256(vault.getOrder(orderId).state), uint256(EvalVaultEscrow.OrderState.Delivered)
        );
    }

    function testEvaluatorCanRejectFundedOrderBeforeDeadline() public {
        uint256 orderId = _buy(BUYER, bytes32("reject"));
        vm.prank(EVALUATOR);
        vm.expectEmit(true, true, false, true, address(vault));
        emit OrderRejected(orderId, REASON);
        vm.expectEmit(true, true, false, true, address(vault));
        emit OrderRefunded(orderId, BUYER, PRICE, EvalVaultEscrow.RefundReason.EvaluatorRejected);
        vault.reject(orderId, REASON);

        EvalVaultEscrow.Order memory order = vault.getOrder(orderId);
        assertEq(order.decisionHash, REASON);
        _assertCredited(orderId, EvalVaultEscrow.OrderState.Refunded, BUYER);
    }

    function testRefundUndeliveredCannotRunEarly() public {
        uint256 orderId = _buy(BUYER, bytes32("not-yet"));
        vm.expectRevert(EvalVaultEscrow.DeadlineNotReached.selector);
        vault.refundUndelivered(orderId);
    }

    function testBuyerAcceptsBeforeReviewDeadlineAndSellerWithdraws() public {
        uint256 orderId = _deliveredOrder(bytes32("accept"));

        vm.prank(OTHER);
        vm.expectRevert(EvalVaultEscrow.Unauthorized.selector);
        vault.accept(orderId);

        vm.prank(BUYER);
        vault.accept(orderId);
        _assertCredited(orderId, EvalVaultEscrow.OrderState.Released, SELLER);

        uint256 beforeBalance = SELLER.balance;
        vm.prank(SELLER);
        vault.withdraw();
        assertEq(SELLER.balance, beforeBalance + PRICE);
        assertEq(vault.credits(SELLER), 0);
        assertEq(vault.totalLiabilities(), 0);
    }

    function testReviewDeadlineBoundaryAllowsPermissionlessRelease() public {
        uint256 orderId = _deliveredOrder(bytes32("review-boundary"));
        uint64 deadline = vault.getOrder(orderId).reviewDeadline;
        vm.warp(deadline);

        vm.prank(BUYER);
        vm.expectRevert(EvalVaultEscrow.DeadlinePassed.selector);
        vault.accept(orderId);

        vm.prank(OTHER);
        vault.releaseAfterReview(orderId);
        _assertCredited(orderId, EvalVaultEscrow.OrderState.Released, SELLER);
    }

    function testBuyerChallengesOnceAndTermsRemainInspectable() public {
        uint256 orderId = _deliveredOrder(bytes32("challenge"));

        vm.prank(OTHER);
        vm.expectRevert(EvalVaultEscrow.Unauthorized.selector);
        vault.challenge(orderId, REASON, EVIDENCE);

        vm.prank(BUYER);
        vault.challenge(orderId, REASON, EVIDENCE);

        EvalVaultEscrow.Order memory order = vault.getOrder(orderId);
        assertEq(uint256(order.state), uint256(EvalVaultEscrow.OrderState.Disputed));
        assertEq(order.challengeReasonHash, REASON);
        assertEq(order.challengeEvidenceHash, EVIDENCE);
        assertEq(order.resolutionDeadline, uint64(block.timestamp + RESOLUTION_WINDOW));

        vm.prank(BUYER);
        vm.expectRevert(
            abi.encodeWithSelector(
                EvalVaultEscrow.InvalidState.selector,
                EvalVaultEscrow.OrderState.Delivered,
                EvalVaultEscrow.OrderState.Disputed
            )
        );
        vault.challenge(orderId, REASON, EVIDENCE);
    }

    function testBuyerCanChallengeOneSecondBeforeReviewDeadline() public {
        uint256 orderId = _deliveredOrder(bytes32("last-second-challenge"));
        uint64 reviewDeadline = vault.getOrder(orderId).reviewDeadline;
        vm.warp(reviewDeadline - 1);

        vm.prank(BUYER);
        vault.challenge(orderId, REASON, EVIDENCE);

        EvalVaultEscrow.Order memory order = vault.getOrder(orderId);
        assertEq(uint256(order.state), uint256(EvalVaultEscrow.OrderState.Disputed));
        assertEq(order.resolutionDeadline, uint64(block.timestamp + RESOLUTION_WINDOW));
    }

    function testEvaluatorResolvesDisputeToEitherParty() public {
        uint256 refundOrder = _disputedOrder(bytes32("resolve-refund"));
        vm.prank(EVALUATOR);
        vm.expectEmit(true, true, false, true, address(vault));
        emit OrderResolved(refundOrder, true, DECISION);
        vm.expectEmit(true, true, false, true, address(vault));
        emit OrderRefunded(refundOrder, BUYER, PRICE, EvalVaultEscrow.RefundReason.ArbiterRefund);
        vault.resolve(refundOrder, true, DECISION);
        _assertCredited(refundOrder, EvalVaultEscrow.OrderState.Refunded, BUYER);

        uint256 releaseOrder = _disputedOrder(bytes32("resolve-release"));
        vm.prank(OTHER);
        vm.expectRevert(EvalVaultEscrow.Unauthorized.selector);
        vault.resolve(releaseOrder, false, DECISION);

        vm.prank(EVALUATOR);
        vault.resolve(releaseOrder, false, DECISION);
        assertEq(
            uint256(vault.getOrder(releaseOrder).state),
            uint256(EvalVaultEscrow.OrderState.Released)
        );
        assertEq(vault.credits(SELLER), PRICE);
        assertEq(vault.getOrder(releaseOrder).decisionHash, DECISION);
        assertEq(vault.totalLiabilities(), PRICE * 2);
        assertEq(address(vault).balance, PRICE * 2);
    }

    function testFuzzResolutionAllocatesPriceExactlyOnce(bool refundBuyer) public {
        uint256 orderId = _disputedOrder(bytes32("fuzz-resolution"));
        vm.prank(EVALUATOR);
        vault.resolve(orderId, refundBuyer, DECISION);

        assertEq(vault.credits(BUYER), refundBuyer ? PRICE : 0);
        assertEq(vault.credits(SELLER), refundBuyer ? 0 : PRICE);
        assertEq(vault.credits(BUYER) + vault.credits(SELLER), PRICE);
        assertEq(vault.totalLiabilities(), PRICE);
        assertEq(address(vault).balance, PRICE);
    }

    function testResolutionDeadlineBoundaryDefaultsToBuyerRefund() public {
        uint256 orderId = _disputedOrder(bytes32("resolution-boundary"));
        uint64 deadline = vault.getOrder(orderId).resolutionDeadline;
        vm.warp(deadline);

        vm.prank(EVALUATOR);
        vm.expectRevert(EvalVaultEscrow.DeadlinePassed.selector);
        vault.resolve(orderId, false, DECISION);

        vm.prank(OTHER);
        vm.expectEmit(true, true, false, true, address(vault));
        emit OrderRefunded(orderId, BUYER, PRICE, EvalVaultEscrow.RefundReason.ResolutionTimeout);
        vault.refundUnresolved(orderId);
        _assertCredited(orderId, EvalVaultEscrow.OrderState.Refunded, BUYER);
    }

    function testTerminalOrderCannotAllocatePriceTwice() public {
        uint256 orderId = _deliveredOrder(bytes32("terminal"));
        vm.prank(BUYER);
        vault.accept(orderId);

        vm.expectRevert(
            abi.encodeWithSelector(
                EvalVaultEscrow.InvalidState.selector,
                EvalVaultEscrow.OrderState.Delivered,
                EvalVaultEscrow.OrderState.Released
            )
        );
        vault.releaseAfterReview(orderId);
        vm.prank(EVALUATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                EvalVaultEscrow.InvalidState.selector,
                EvalVaultEscrow.OrderState.Disputed,
                EvalVaultEscrow.OrderState.Released
            )
        );
        vault.resolve(orderId, true, DECISION);
        assertEq(vault.credits(SELLER), PRICE);
        assertEq(vault.credits(BUYER), 0);
        assertEq(vault.totalLiabilities(), PRICE);
    }

    function testWithdrawalFailurePreservesCreditAndLiability() public {
        RejectingSeller seller = new RejectingSeller(vault);
        uint256 orderId = seller.list(ARTIFACT, TERMS, PRICE, uint64(block.timestamp + 1 days));
        vm.prank(BUYER);
        uint256 purchaseId = vault.buy{ value: PRICE }(orderId, bytes32("reject-eth"));
        vm.prank(EVALUATOR);
        vault.markDelivered(purchaseId, RECEIPT);
        vm.prank(BUYER);
        vault.accept(purchaseId);

        vm.expectRevert(EvalVaultEscrow.TransferFailed.selector);
        seller.withdrawCredit();
        assertEq(vault.credits(address(seller)), PRICE);
        assertEq(vault.totalLiabilities(), PRICE);

        seller.setRejectPayment(false);
        seller.withdrawCredit();
        assertEq(vault.credits(address(seller)), 0);
        assertEq(vault.totalLiabilities(), 0);
        assertEq(address(seller).balance, PRICE);
    }

    function testWithdrawalBlocksReentrantDoubleSpend() public {
        ReentrantSeller seller = new ReentrantSeller(vault);
        uint256 listed = seller.list(ARTIFACT, TERMS, PRICE, uint64(block.timestamp + 1 days));
        vm.prank(BUYER);
        uint256 orderId = vault.buy{ value: PRICE }(listed, bytes32("reenter"));
        vm.prank(EVALUATOR);
        vault.markDelivered(orderId, RECEIPT);
        vm.prank(BUYER);
        vault.accept(orderId);

        seller.withdrawCredit();
        assertEq(address(seller).balance, PRICE);
        assertEq(seller.attempts(), 1);
        assertFalse(seller.nestedCallSucceeded());
        assertEq(vault.credits(address(seller)), 0);
        assertEq(vault.totalLiabilities(), 0);
    }

    function testWithdrawAccumulatesCreditsAcrossOrders() public {
        uint256 firstOrder = _deliveredOrder(bytes32("accumulated-first"));
        vm.prank(BUYER);
        vault.accept(firstOrder);

        uint256 secondOrder = _deliveredOrder(bytes32("accumulated-second"));
        vm.prank(BUYER);
        vault.accept(secondOrder);

        assertEq(vault.credits(SELLER), PRICE * 2);
        uint256 beforeBalance = SELLER.balance;
        vm.prank(SELLER);
        vault.withdraw();

        assertEq(SELLER.balance, beforeBalance + PRICE * 2);
        assertEq(vault.credits(SELLER), 0);
        assertEq(vault.totalLiabilities(), 0);
        assertEq(address(vault).balance, 0);
    }

    function testForcedEtherDoesNotChangeLiabilitiesOrBlockWithdrawal() public {
        uint256 orderId = _deliveredOrder(bytes32("forced-ether"));
        vm.prank(BUYER);
        vault.accept(orderId);

        uint256 forcedAmount = 1 ether;
        vm.deal(address(this), forcedAmount);
        ForceEther force = new ForceEther{ value: forcedAmount }();
        force.sendTo(payable(address(vault)));

        assertEq(address(vault).balance, PRICE + forcedAmount);
        assertEq(vault.totalLiabilities(), PRICE);

        vm.prank(SELLER);
        vault.withdraw();
        assertEq(address(vault).balance, forcedAmount);
        assertEq(vault.totalLiabilities(), 0);
    }

    function _buy(address buyer, bytes32 requestId) internal returns (uint256 orderId) {
        vm.prank(buyer);
        orderId = vault.buy{ value: PRICE }(listingId, requestId);
    }

    function _deliveredOrder(bytes32 requestId) internal returns (uint256 orderId) {
        orderId = _buy(BUYER, requestId);
        vm.prank(EVALUATOR);
        vault.markDelivered(orderId, RECEIPT);
    }

    function _disputedOrder(bytes32 requestId) internal returns (uint256 orderId) {
        orderId = _deliveredOrder(requestId);
        vm.prank(BUYER);
        vault.challenge(orderId, REASON, EVIDENCE);
    }

    function _assertCredited(
        uint256 orderId,
        EvalVaultEscrow.OrderState expected,
        address recipient
    ) internal view {
        assertEq(uint256(vault.getOrder(orderId).state), uint256(expected));
        assertEq(vault.credits(recipient), PRICE);
        assertEq(vault.totalLiabilities(), PRICE);
        assertEq(address(vault).balance, PRICE);
    }
}

contract RejectingSeller {
    EvalVaultEscrow private immutable _vault;
    bool private _rejectPayment = true;

    constructor(EvalVaultEscrow vault_) {
        _vault = vault_;
    }

    function list(bytes32 artifact, bytes32 terms, uint256 price, uint64 expiresAt)
        external
        returns (uint256)
    {
        return _vault.createListing(artifact, terms, price, expiresAt);
    }

    function setRejectPayment(bool rejectPayment) external {
        _rejectPayment = rejectPayment;
    }

    function withdrawCredit() external {
        _vault.withdraw();
    }

    receive() external payable {
        if (_rejectPayment) revert("payment rejected");
    }
}

contract ReentrantSeller {
    EvalVaultEscrow private immutable _vault;
    uint256 public attempts;
    bool public nestedCallSucceeded;

    constructor(EvalVaultEscrow vault_) {
        _vault = vault_;
    }

    function list(bytes32 artifact, bytes32 terms, uint256 price, uint64 expiresAt)
        external
        returns (uint256)
    {
        return _vault.createListing(artifact, terms, price, expiresAt);
    }

    function withdrawCredit() external {
        _vault.withdraw();
    }

    receive() external payable {
        attempts++;
        (nestedCallSucceeded,) =
            address(_vault).call(abi.encodeWithSelector(EvalVaultEscrow.withdraw.selector));
    }
}

contract ForceEther {
    constructor() payable { }

    function sendTo(address payable recipient) external {
        selfdestruct(recipient);
    }
}

contract EvalVaultEscrowHandler is TestBase {
    uint256 internal constant PRICE = 0.04 ether;
    bytes32 internal constant RECEIPT = keccak256("invariant-receipt");
    bytes32 internal constant REASON = keccak256("invariant-reason");
    bytes32 internal constant EVIDENCE = keccak256("invariant-evidence");
    bytes32 internal constant DECISION = keccak256("invariant-decision");

    EvalVaultEscrow public immutable vault;
    uint256 public immutable listingId;
    address public immutable seller;
    address public immutable evaluator;

    uint256[] private _orderIds;
    address[] private _actors;
    mapping(uint256 => uint256) public allocationCount;
    uint256 public fundedCount;
    uint256 public terminalCount;
    uint256 public requestNonce;
    bool public invalidAllocation;

    constructor(EvalVaultEscrow vault_, uint256 listingId_, address seller_, address evaluator_) {
        vault = vault_;
        listingId = listingId_;
        seller = seller_;
        evaluator = evaluator_;
        _actors.push(seller_);
    }

    function bootstrap() external {
        buy(1);
        progress(0, 0);
        progress(0, 0);
        buy(2);
    }

    function buy(uint256 buyerSeed) public {
        if (_orderIds.length >= 24) return;
        address buyer = address(uint160(0x10000 + (buyerSeed % 32)));
        bytes32 requestId = keccak256(abi.encode(buyer, requestNonce++));
        vm.deal(buyer, PRICE);
        vm.prank(buyer);
        uint256 orderId = vault.buy{ value: PRICE }(listingId, requestId);
        _orderIds.push(orderId);
        _actors.push(buyer);
        fundedCount++;
    }

    function progress(uint256 orderSeed, uint256 pathSeed) public {
        if (_orderIds.length == 0) return;
        uint256 orderId = _orderIds[orderSeed % _orderIds.length];
        EvalVaultEscrow.Order memory order = vault.getOrder(orderId);

        if (order.state == EvalVaultEscrow.OrderState.Funded) {
            if (block.timestamp >= order.deliveryDeadline) {
                _settleRefundUndelivered(orderId, order);
            } else if (pathSeed % 3 == 0) {
                vm.prank(evaluator);
                vault.markDelivered(orderId, RECEIPT);
            } else if (pathSeed % 3 == 1) {
                uint256 buyerCredit = vault.credits(order.buyer);
                uint256 sellerCredit = vault.credits(order.seller);
                vm.prank(evaluator);
                vault.reject(orderId, REASON);
                _recordAllocation(orderId, order, buyerCredit, sellerCredit);
            } else {
                vm.warp(order.deliveryDeadline);
                _settleRefundUndelivered(orderId, order);
            }
            return;
        }

        if (order.state == EvalVaultEscrow.OrderState.Delivered) {
            if (block.timestamp >= order.reviewDeadline) {
                _settleReleaseAfterReview(orderId, order);
            } else if (pathSeed % 3 == 0) {
                uint256 buyerCredit = vault.credits(order.buyer);
                uint256 sellerCredit = vault.credits(order.seller);
                vm.prank(order.buyer);
                vault.accept(orderId);
                _recordAllocation(orderId, order, buyerCredit, sellerCredit);
            } else if (pathSeed % 3 == 1) {
                vm.prank(order.buyer);
                vault.challenge(orderId, REASON, EVIDENCE);
            } else {
                vm.warp(order.reviewDeadline);
                _settleReleaseAfterReview(orderId, order);
            }
            return;
        }

        if (order.state == EvalVaultEscrow.OrderState.Disputed) {
            if (block.timestamp >= order.resolutionDeadline) {
                _settleRefundUnresolved(orderId, order);
            } else if (pathSeed % 3 < 2) {
                uint256 buyerCredit = vault.credits(order.buyer);
                uint256 sellerCredit = vault.credits(order.seller);
                vm.prank(evaluator);
                vault.resolve(orderId, pathSeed % 3 == 0, DECISION);
                _recordAllocation(orderId, order, buyerCredit, sellerCredit);
            } else {
                vm.warp(order.resolutionDeadline);
                _settleRefundUnresolved(orderId, order);
            }
        }
    }

    function withdraw(uint256 actorSeed) external {
        if (_actors.length == 0) return;
        address actor = _actors[actorSeed % _actors.length];
        if (vault.credits(actor) == 0) return;
        vm.prank(actor);
        vault.withdraw();
    }

    function orderCount() external view returns (uint256) {
        return _orderIds.length;
    }

    function orderIdAt(uint256 index) external view returns (uint256) {
        return _orderIds[index];
    }

    function _settleRefundUndelivered(uint256 orderId, EvalVaultEscrow.Order memory order) private {
        uint256 buyerCredit = vault.credits(order.buyer);
        uint256 sellerCredit = vault.credits(order.seller);
        vault.refundUndelivered(orderId);
        _recordAllocation(orderId, order, buyerCredit, sellerCredit);
    }

    function _settleReleaseAfterReview(uint256 orderId, EvalVaultEscrow.Order memory order)
        private
    {
        uint256 buyerCredit = vault.credits(order.buyer);
        uint256 sellerCredit = vault.credits(order.seller);
        vault.releaseAfterReview(orderId);
        _recordAllocation(orderId, order, buyerCredit, sellerCredit);
    }

    function _settleRefundUnresolved(uint256 orderId, EvalVaultEscrow.Order memory order) private {
        uint256 buyerCredit = vault.credits(order.buyer);
        uint256 sellerCredit = vault.credits(order.seller);
        vault.refundUnresolved(orderId);
        _recordAllocation(orderId, order, buyerCredit, sellerCredit);
    }

    function _recordAllocation(
        uint256 orderId,
        EvalVaultEscrow.Order memory order,
        uint256 buyerCreditBefore,
        uint256 sellerCreditBefore
    ) private {
        uint256 buyerDelta =
            vault.credits(order.buyer) - buyerCreditBefore;
        uint256 sellerDelta = vault.credits(order.seller) - sellerCreditBefore;
        bool exactlyOneRecipient = (buyerDelta == order.price && sellerDelta == 0)
            || (buyerDelta == 0 && sellerDelta == order.price);
        if (!exactlyOneRecipient) invalidAllocation = true;
        allocationCount[orderId]++;
        terminalCount++;
    }
}

contract EvalVaultEscrowInvariantTest is TestBase {
    address internal constant EVALUATOR = address(0xE11A);
    address internal constant SELLER = address(0x5E11E2);
    uint256 internal constant PRICE = 0.04 ether;

    EvalVaultEscrow internal vault;
    EvalVaultEscrowHandler internal handler;

    function setUp() public {
        vault = new EvalVaultEscrow(EVALUATOR, 2 minutes, 3 minutes, 5 minutes);
        vm.prank(SELLER);
        uint256 listingId = vault.createListing(
            keccak256("invariant-artifact"),
            keccak256("invariant-terms"),
            PRICE,
            uint64(block.timestamp + 30 days)
        );
        handler = new EvalVaultEscrowHandler(vault, listingId, SELLER, EVALUATOR);
        handler.bootstrap();
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function targetSelectors() public view returns (FuzzSelector[] memory targetedSelectors) {
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.buy.selector;
        selectors[1] = handler.progress.selector;
        selectors[2] = handler.withdraw.selector;

        targetedSelectors = new FuzzSelector[](1);
        targetedSelectors[0] = FuzzSelector({ addr: address(handler), selectors: selectors });
    }

    function invariantLiabilitiesNeverExceedBalance() public view {
        assertTrue(vault.totalLiabilities() <= address(vault).balance);
        assertTrue(handler.fundedCount() > 0);
        assertTrue(handler.terminalCount() > 0);
    }

    function invariantTerminalOrdersAllocateExactlyOnce() public view {
        assertFalse(handler.invalidAllocation());
        uint256 length = handler.orderCount();
        for (uint256 i; i < length; ++i) {
            uint256 orderId = handler.orderIdAt(i);
            EvalVaultEscrow.OrderState state = vault.getOrder(orderId).state;
            if (
                state == EvalVaultEscrow.OrderState.Released
                    || state == EvalVaultEscrow.OrderState.Refunded
            ) {
                assertEq(handler.allocationCount(orderId), 1);
            } else {
                assertEq(handler.allocationCount(orderId), 0);
            }
        }
    }
}
