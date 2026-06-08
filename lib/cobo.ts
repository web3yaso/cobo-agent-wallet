import {
  CAW_BIN,
  COBO_BASE_URL,
  COBO_PACT_ID,
  COBO_X402_CHAIN_IDS,
  COBO_X402_TOKEN_REFS,
  DAILY_BUDGET_USDC,
  DAILY_PAYMENT_LIMIT,
  MAX_REPORT_BASE_UNITS,
  MAX_REPORT_USDC,
  X402_NETWORK,
  requireEnv,
} from "./config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PaymentRequirement } from "./types";

const execFileAsync = promisify(execFile);

export type CoboPairingStatus = {
  paired: boolean;
  walletUuid: string | null;
  pactId: string | null;
  pactStatus: string;
  pactName?: string;
  walletId?: string;
  expiresAt?: string;
  progressTxCount?: number;
  progressUsdSpent?: string;
  supportedChains: string[];
  supportedTokens: Array<{ chain_id: string; token_id: string }>;
  missing: string[];
  error?: string;
};

type CoboPaymentResponse = {
  payment_signature?: string;
  paymentSignature?: string;
  PAYMENT_SIGNATURE?: string;
  headers?: Record<string, string>;
};

function coboHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${requireEnv("COBO_API_KEY")}`,
  };
}

function redactSensitive(value: string): string {
  return value
    .replace(/caw_[A-Za-z0-9_-]+/g, "caw_[REDACTED]")
    .replace(/"api_key"\s*:\s*"[^"]+"/g, '"api_key":"[REDACTED]"');
}

function configuredPairingBase(): CoboPairingStatus {
  const walletUuid = process.env.COBO_WALLET_UUID || null;
  const pactId = COBO_PACT_ID || null;
  const missing = [
    process.env.COBO_API_KEY ? "" : "COBO_API_KEY",
    walletUuid ? "" : "COBO_WALLET_UUID",
    pactId ? "" : "COBO_PACT_ID",
  ].filter(Boolean);

  return {
    paired: false,
    walletUuid,
    pactId,
    pactStatus: missing.length ? "missing_config" : "checking",
    supportedChains: COBO_X402_CHAIN_IDS,
    supportedTokens: COBO_X402_TOKEN_REFS,
    missing,
  };
}

export async function getCoboPairingStatus(): Promise<CoboPairingStatus> {
  const base = configuredPairingBase();
  if (base.missing.length > 0 || !base.pactId) {
    return base;
  }

  const args = [
    "pact",
    "status",
    "--pact-id",
    base.pactId,
    "--api-url",
    COBO_BASE_URL,
  ];

  try {
    const { stdout } = await execFileAsync(CAW_BIN, args, {
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
      env: {
        ...process.env,
        AGENT_WALLET_API_URL: COBO_BASE_URL,
      },
    });
    const payload = JSON.parse(stdout) as {
      status?: string;
      name?: string;
      wallet_id?: string;
      expires_at?: string;
      progress_tx_count?: number;
      progress_usd_spent?: string;
    };
    const pactStatus = payload.status || "unknown";

    return {
      ...base,
      paired: pactStatus === "active",
      pactStatus,
      pactName: payload.name,
      walletId: payload.wallet_id,
      expiresAt: payload.expires_at,
      progressTxCount: payload.progress_tx_count,
      progressUsdSpent: payload.progress_usd_spent,
    };
  } catch (caught) {
    const error = caught as Error & { stdout?: string; stderr?: string };
    return {
      ...base,
      pactStatus: "error",
      error: redactSensitive([error.message, error.stdout, error.stderr].filter(Boolean).join("\n")),
    };
  }
}

export function getCoboWalletUuid(): string {
  return requireEnv("COBO_WALLET_UUID");
}

export async function payX402Requirement(requirement: PaymentRequirement): Promise<string> {
  const walletUuid = getCoboWalletUuid();
  const response = await fetch(`${COBO_BASE_URL}/v1/wallets/${walletUuid}/payment`, {
    method: "POST",
    headers: coboHeaders(),
    body: JSON.stringify({
      protocol: "x402",
      payment_required: requirement.rawHeader,
      paymentRequired: requirement.rawHeader,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Cobo x402 payment failed: HTTP ${response.status} ${text}`);
  }

  const payload = text ? (JSON.parse(text) as CoboPaymentResponse) : {};
  const signature =
    payload.payment_signature ||
    payload.paymentSignature ||
    payload.PAYMENT_SIGNATURE ||
    payload.headers?.["PAYMENT-SIGNATURE"] ||
    payload.headers?.["payment-signature"];

  if (!signature) {
    throw new Error("Cobo x402 payment response did not include PAYMENT-SIGNATURE.");
  }

  return signature;
}

export async function cawFetchX402(readUrl: string, requirement: PaymentRequirement): Promise<string> {
  if (!COBO_PACT_ID) {
    throw new Error(
      "Missing COBO_PACT_ID. Create and approve a Cobo pact for Citely Reader, then add COBO_PACT_ID to .env.local.",
    );
  }

  const args = [
    "fetch",
    COBO_PACT_ID,
    readUrl,
    "--protocol",
    "x402",
    "--network",
    requirement.network || X402_NETWORK,
    "--asset",
    requirement.asset || "",
    "--max-amount",
    String(MAX_REPORT_BASE_UNITS),
    "--output",
    "body",
    "--api-url",
    COBO_BASE_URL,
  ].filter((value) => value !== "");

  try {
    const { stdout } = await execFileAsync(CAW_BIN, args, {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        AGENT_WALLET_API_URL: COBO_BASE_URL,
      },
    });
    return stdout.trim();
  } catch (caught) {
    const error = caught as Error & { stdout?: string; stderr?: string; code?: number };
    const detail = [error.message, error.stdout, error.stderr]
      .filter(Boolean)
      .join("\n")
      .replace(/caw_[A-Za-z0-9_-]+/g, "caw_[REDACTED]");
    throw new Error(`caw fetch x402 failed${error.code ? ` (exit ${error.code})` : ""}: ${detail}`);
  }
}

export function buildCitelyReaderPactDraft() {
  return {
    intent: "Read x402write paid reports with small USDC payments on Base mainnet",
    execution_plan:
      "# Summary\n" +
      "Use the agent wallet to pay x402 payment requests for x402write reports, then retrieve and summarize the paid report content.\n\n" +
      "# Allowed Scope\n" +
      "- Pay x402 payment requests only\n" +
      "- Use Base mainnet USDC or Solana Devnet USDC only\n" +
      "- Use USDC only\n" +
      "- Pay exact quoted amount only\n" +
      "- Do not pay the wallet's own address\n\n" +
      "# Budget\n" +
      `- Maximum ${MAX_REPORT_USDC.toFixed(2)} USDC per report\n` +
      `- Maximum ${DAILY_BUDGET_USDC.toFixed(2)} USDC per rolling 24 hours\n` +
      `- Maximum ${DAILY_PAYMENT_LIMIT} payments per rolling 24 hours\n\n` +
      "# Completion\n" +
      "Stop when the daily budget, daily payment count, or pact expiration is reached.",
    policies: [
      {
        name: "x402write-daily-reading-budget",
        type: "transfer",
        rules: {
          effect: "allow",
          when: {
            chain_in: COBO_X402_CHAIN_IDS,
            token_in: COBO_X402_TOKEN_REFS,
          },
          deny_if: {
            amount_gt: MAX_REPORT_USDC.toFixed(2),
            usage_limits: {
              rolling_24h: {
                amount_gt: DAILY_BUDGET_USDC.toFixed(2),
                tx_count_gt: DAILY_PAYMENT_LIMIT,
              },
            },
          },
        },
      },
    ],
    completion_conditions: [
      {
        type: "amount_spent",
        threshold: DAILY_BUDGET_USDC.toFixed(2),
      },
      {
        type: "tx_count",
        threshold: String(DAILY_PAYMENT_LIMIT),
      },
      {
        type: "time_elapsed",
        threshold: "604800",
      },
    ],
  };
}
