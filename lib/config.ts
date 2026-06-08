export const X402WRITE_BASE_URL =
  process.env.X402WRITE_BASE_URL || "https://x402write.vercel.app";

export const X402_ARTICLE_PATH_PREFIX =
  process.env.X402_ARTICLE_PATH_PREFIX || "/api/v1/articles";

export const COBO_BASE_URL =
  process.env.COBO_BASE_URL || "https://api.agenticwallet.cobo.com";

export const COBO_PACT_ID = process.env.COBO_PACT_ID;

export const CAW_BIN = process.env.CAW_BIN || "caw";

// Payments require the `caw` CLI, which cannot run on serverless hosts (e.g.
// Vercel). Set PAYMENTS_ENABLED=false there to disable the payment path
// gracefully: free reads still work, paid reads return a clear message, and the
// pairing status endpoint reports "disabled" instead of shelling out to caw.
export const PAYMENTS_ENABLED =
  (process.env.PAYMENTS_ENABLED ?? "true").toLowerCase() !== "false";

export const MAX_REPORT_USDC = Number(process.env.MAX_REPORT_USDC || "0.50");

export const DAILY_BUDGET_USDC = Number(process.env.DAILY_BUDGET_USDC || "5.00");

export const DAILY_PAYMENT_LIMIT = Number(process.env.DAILY_PAYMENT_LIMIT || "50");

export const REPORT_CACHE_TTL_SECONDS = Number(
  process.env.REPORT_CACHE_TTL_SECONDS || "604800",
);

export const X402_NETWORK = process.env.X402_NETWORK || "eip155:8453";

export const X402_ASSET = process.env.X402_ASSET;

const DEFAULT_X402_ALLOWED_NETWORKS = [
  "eip155:8453",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
];

const DEFAULT_X402_ALLOWED_ASSETS = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
];

function splitCsv(value: string | undefined, fallback: string[]): string[] {
  const source = value?.trim() ? value : fallback.join(",");
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const X402_ALLOWED_NETWORKS = splitCsv(
  process.env.X402_ALLOWED_NETWORKS,
  DEFAULT_X402_ALLOWED_NETWORKS,
);

export const X402_ALLOWED_ASSETS = splitCsv(
  process.env.X402_ALLOWED_ASSETS,
  X402_ASSET ? [X402_ASSET] : DEFAULT_X402_ALLOWED_ASSETS,
);

export const COBO_X402_CHAIN_ID = process.env.COBO_X402_CHAIN_ID || "BASE_ETH";

export const COBO_X402_TOKEN_ID = process.env.COBO_X402_TOKEN_ID || "BASE_USDC";

export const COBO_X402_CHAIN_IDS = splitCsv(process.env.COBO_X402_CHAIN_IDS, [
  COBO_X402_CHAIN_ID,
  "SOLDEV_SOL",
]);

export const COBO_X402_TOKEN_REFS = splitCsv(process.env.COBO_X402_TOKEN_REFS, [
  `${COBO_X402_CHAIN_ID}:${COBO_X402_TOKEN_ID}`,
  "SOLDEV_SOL:SOLDEV_SOL_USDC",
]).map((ref) => {
  const [chain_id, token_id] = ref.split(":");
  return { chain_id, token_id };
});

export const USDC_DECIMALS = 6;

export const MAX_REPORT_BASE_UNITS = Math.round(MAX_REPORT_USDC * 10 ** USDC_DECIMALS);

export const DAILY_BUDGET_BASE_UNITS = Math.round(
  DAILY_BUDGET_USDC * 10 ** USDC_DECIMALS,
);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
