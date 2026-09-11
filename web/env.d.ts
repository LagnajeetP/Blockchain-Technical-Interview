declare namespace Cloudflare {
  interface Env {
    FILES: R2Bucket;
    DB: D1Database;
    DEMO_CHAIN_MODE?: 'simulation' | 'live';
    BASE_SEPOLIA_RPC_URL?: string;
    EVALVAULT_CONTRACT_ADDRESS?: `0x${string}`;
    OPERATOR_PRIVATE_KEY?: `0x${string}`;
    EVALUATOR_PRIVATE_KEY?: `0x${string}`;
    BUYER_PRIVATE_KEY?: `0x${string}`;
    OPERATOR_TOKEN?: string;
    EVALUATION_SEED?: string;
    PUBLIC_LIVE_RUNS_ENABLED?: 'true' | 'false';
    LIVE_RUN_BUDGET_WEI?: string;
    EVALVAULT_DEPLOYMENT_BLOCK?: string;
  }
}
