import { env } from 'cloudflare:workers';
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToHex,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

export const ESCROW_ABI = parseAbi([
  'function createListing(bytes32 artifactCommitment, bytes32 termsHash, uint256 price, uint64 expiresAt) returns (uint256)',
  'function buy(uint256 listingId, bytes32 requestId) payable returns (uint256)',
  'function markDelivered(uint256 orderId, bytes32 receiptHash)',
  'function reject(uint256 orderId, bytes32 reasonCodeHash)',
  'function accept(uint256 orderId)',
  'function withdraw()',
  'function evaluator() view returns (address)',
  'function getListing(uint256 listingId) view returns ((address seller, address evaluator, bytes32 artifactCommitment, bytes32 termsHash, uint256 price, uint64 expiresAt))',
  'event ListingCreated(uint256 indexed listingId, address indexed seller, address indexed evaluator, bytes32 artifactCommitment, bytes32 termsHash, uint256 price, uint64 expiresAt)',
  'event OrderFunded(uint256 indexed orderId, uint256 indexed listingId, address indexed buyer, address seller, address evaluator, bytes32 requestId, uint256 price, uint64 deliveryDeadline)',
  'event OrderDelivered(uint256 indexed orderId, bytes32 indexed receiptHash, uint64 reviewDeadline)',
  'event OrderRejected(uint256 indexed orderId, bytes32 indexed reasonCodeHash)',
  'event OrderRefunded(uint256 indexed orderId, address indexed buyer, uint256 amount, uint8 reason)',
  'event OrderAccepted(uint256 indexed orderId, address indexed buyer)',
  'event OrderReleased(uint256 indexed orderId, address indexed seller, uint256 amount)',
  'event Withdrawal(address indexed account, uint256 amount)',
]);

export type EscrowEventName =
  | 'ListingCreated'
  | 'OrderFunded'
  | 'OrderDelivered'
  | 'OrderRejected'
  | 'OrderRefunded'
  | 'OrderAccepted'
  | 'OrderReleased'
  | 'Withdrawal';

function requiredAddress(name: string, value: string | undefined) {
  if (!value || !isAddress(value))
    throw new Error(`${name} is not a valid address`);
  return getAddress(value);
}

function requiredPrivateKey(name: string, value: string | undefined): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${name} is not a valid private key`);
  return value as Hex;
}

function config() {
  const rpcUrl = env.BASE_SEPOLIA_RPC_URL;
  const address = requiredAddress(
    'EVALVAULT_CONTRACT_ADDRESS',
    env.EVALVAULT_CONTRACT_ADDRESS,
  );
  if (!rpcUrl) throw new Error('BASE_SEPOLIA_RPC_URL is not configured');
  const operatorKey = requiredPrivateKey(
    'OPERATOR_PRIVATE_KEY',
    env.OPERATOR_PRIVATE_KEY,
  );
  return {
    rpcUrl,
    address,
    operator: privateKeyToAccount(operatorKey),
    evaluator: privateKeyToAccount(
      env.EVALUATOR_PRIVATE_KEY
        ? requiredPrivateKey('EVALUATOR_PRIVATE_KEY', env.EVALUATOR_PRIVATE_KEY)
        : operatorKey,
    ),
    buyer: privateKeyToAccount(
      requiredPrivateKey('BUYER_PRIVATE_KEY', env.BUYER_PRIVATE_KEY),
    ),
  };
}

function clients(role: 'operator' | 'evaluator' | 'buyer') {
  const values = config();
  const account = values[role];
  const transport = http(values.rpcUrl);
  return {
    ...values,
    account,
    publicClient: createPublicClient({ chain: baseSepolia, transport }),
    walletClient: createWalletClient({
      account,
      chain: baseSepolia,
      transport,
    }),
  };
}

export function liveChainConfigured(): boolean {
  return (
    env.DEMO_CHAIN_MODE === 'live' &&
    Boolean(
      env.BASE_SEPOLIA_RPC_URL &&
      env.EVALVAULT_CONTRACT_ADDRESS &&
      env.OPERATOR_PRIVATE_KEY &&
      env.BUYER_PRIVATE_KEY,
    )
  );
}

export function liveChainEnabled(): boolean {
  return liveChainConfigured() && env.PUBLIC_LIVE_RUNS_ENABLED === 'true';
}

export function publicChainInfo() {
  const live = liveChainEnabled();
  const rpcUrl = env.BASE_SEPOLIA_RPC_URL;
  let localRpc = false;
  if (live && rpcUrl) {
    try {
      const hostname = new URL(rpcUrl).hostname;
      localRpc = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    } catch {
      // assertLiveConfiguration reports malformed or unreachable RPC values.
    }
  }
  return {
    mode: live ? ('live' as const) : ('simulation' as const),
    environment: !live
      ? ('simulation' as const)
      : localRpc
        ? ('local' as const)
        : ('testnet' as const),
    chainId: baseSepolia.id,
    chainName: !live
      ? 'Simulation ledger'
      : localRpc
        ? 'Local Anvil'
        : baseSepolia.name,
    contractAddress: live ? env.EVALVAULT_CONTRACT_ADDRESS || null : null,
    explorerUrl:
      live && !localRpc && env.EVALVAULT_CONTRACT_ADDRESS
        ? `${baseSepolia.blockExplorers.default.url}/address/${env.EVALVAULT_CONTRACT_ADDRESS}`
        : null,
    transactionExplorerUrl:
      live && !localRpc
        ? `${baseSepolia.blockExplorers.default.url}/tx/`
        : null,
  };
}

export function requestIdFor(runId: string): Hex {
  return keccak256(stringToHex(`evalvault:${runId}`));
}

export interface PreparedTransaction {
  hash: Hash;
  serializedTransaction: Hex;
}

async function prepare(
  role: 'operator' | 'evaluator' | 'buyer',
  functionName:
    | 'createListing'
    | 'buy'
    | 'markDelivered'
    | 'reject'
    | 'accept'
    | 'withdraw',
  args: readonly unknown[] = [],
  value?: bigint,
): Promise<PreparedTransaction> {
  const { address, account, publicClient, walletClient } = clients(role);
  await publicClient.simulateContract({
    address,
    abi: ESCROW_ABI,
    account,
    functionName,
    args,
    ...(value === undefined ? {} : { value }),
  } as never);
  const data = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName,
    args,
  } as never);
  const prepared = await walletClient.prepareTransactionRequest({
    account,
    chain: baseSepolia,
    to: address,
    data,
    ...(value === undefined ? {} : { value }),
  });
  const serializedTransaction = await account.signTransaction(
    prepared as never,
  );
  return { hash: keccak256(serializedTransaction), serializedTransaction };
}

export function prepareCreateListing(
  commitment: Hex,
  termsHash: Hex,
  price: bigint,
  expiresAt: bigint,
) {
  return prepare('operator', 'createListing', [
    commitment,
    termsHash,
    price,
    expiresAt,
  ]);
}

export function prepareBuy(listingId: bigint, requestId: Hex, value: bigint) {
  return prepare('buyer', 'buy', [listingId, requestId], value);
}

export function prepareDelivery(orderId: bigint, receiptHash: Hex) {
  return prepare('evaluator', 'markDelivered', [orderId, receiptHash]);
}

export function prepareReject(orderId: bigint, reasonHash: Hex) {
  return prepare('evaluator', 'reject', [orderId, reasonHash]);
}

export function prepareAccept(orderId: bigint) {
  return prepare('buyer', 'accept', [orderId]);
}

export function prepareWithdraw(role: 'operator' | 'buyer') {
  return prepare(role, 'withdraw');
}

export async function broadcastPrepared(
  serializedTransaction: Hex,
): Promise<Hash> {
  const { walletClient } = clients('buyer');
  return walletClient.sendRawTransaction({ serializedTransaction });
}

export function chainActors() {
  const values = config();
  return {
    operator: values.operator.address,
    evaluator: values.evaluator.address,
    buyer: values.buyer.address,
  };
}

export async function assertLiveConfiguration(): Promise<void> {
  const { address, evaluator, publicClient } = clients('buyer');
  const chainId = await publicClient.getChainId();
  if (chainId !== baseSepolia.id)
    throw new Error(
      `RPC chain ID ${chainId} is not Base Sepolia ${baseSepolia.id}`,
    );
  const bytecode = await publicClient.getCode({ address });
  if (!bytecode || bytecode === '0x')
    throw new Error('Configured escrow address has no contract bytecode');
  const onchainEvaluator = await publicClient.readContract({
    address,
    abi: ESCROW_ABI,
    functionName: 'evaluator',
  });
  if (getAddress(onchainEvaluator) !== getAddress(evaluator.address)) {
    throw new Error(
      'Configured evaluator signer does not match the contract evaluator',
    );
  }
}

export async function assertListingBinding(
  listingId: bigint,
  commitment: Hex,
  termsHash: Hex,
  price: bigint,
  expiresAt: bigint,
): Promise<void> {
  const { address, evaluator, operator, publicClient } = clients('buyer');
  const listing = await publicClient.readContract({
    address,
    abi: ESCROW_ABI,
    functionName: 'getListing',
    args: [listingId],
  });
  const value = listing as unknown as {
    seller: string;
    evaluator: string;
    artifactCommitment: Hex;
    termsHash: Hex;
    price: bigint;
    expiresAt: bigint;
  };
  if (
    getAddress(value.seller) !== getAddress(operator.address) ||
    getAddress(value.evaluator) !== getAddress(evaluator.address) ||
    value.artifactCommitment !== commitment ||
    value.termsHash !== termsHash ||
    value.price !== price ||
    value.expiresAt !== expiresAt ||
    value.expiresAt <= BigInt(Math.floor(Date.now() / 1000))
  ) {
    throw new Error(
      'D1 listing metadata does not match the immutable on-chain listing',
    );
  }
}

export interface ConfirmedEvent {
  hash: Hash;
  blockNumber: string;
  logIndex: number;
  eventName: EscrowEventName;
  args: Record<string, unknown>;
  transactionTo: string;
}

export async function confirmEvent(
  hash: Hash,
  expected: EscrowEventName,
  expectedSender?: string,
): Promise<ConfirmedEvent> {
  const { address, publicClient } = clients('buyer');
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash });
  } catch {
    receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 25_000,
    });
  }
  if (receipt.status !== 'success')
    throw new Error(`Transaction ${hash} reverted`);
  if (!receipt.to || getAddress(receipt.to) !== getAddress(address)) {
    throw new Error(`Transaction ${hash} did not target the configured escrow`);
  }
  if (
    expectedSender &&
    getAddress(receipt.from) !== getAddress(expectedSender)
  ) {
    throw new Error(`Transaction ${hash} was not sent by the expected actor`);
  }
  const decoded = parseEventLogs({
    abi: ESCROW_ABI,
    logs: receipt.logs,
    strict: false,
  });
  const matchingEvents = decoded.filter(
    (entry) =>
      entry.eventName === expected &&
      getAddress(entry.address) === getAddress(address),
  );
  if (matchingEvents.length !== 1) {
    throw new Error(
      `Transaction ${hash} emitted ${matchingEvents.length} matching ${expected} events`,
    );
  }
  const event = matchingEvents[0];
  return {
    hash,
    blockNumber: receipt.blockNumber.toString(),
    logIndex: Number(event.logIndex),
    eventName: expected,
    args: event.args as Record<string, unknown>,
    transactionTo: receipt.to,
  };
}
