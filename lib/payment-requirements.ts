import {
  MAX_REPORT_BASE_UNITS,
  X402_ALLOWED_ASSETS,
  X402_ALLOWED_NETWORKS,
} from "./config";
import { formatUsdc, parseUsdcBaseUnits } from "./money";
import type { PaymentRequirement } from "./types";

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodePaymentHeader(header: string): unknown {
  const trimmed = header.trim();
  const candidates = [trimmed];

  try {
    candidates.push(Buffer.from(trimmed, "base64").toString("utf8"));
  } catch {
    // Keep the original candidate only.
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  throw new Error("Payment-Required header is not valid JSON or Base64 JSON.");
}

function getString(record: AnyRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function findRequirementRecord(decoded: unknown): AnyRecord {
  if (!isRecord(decoded)) {
    throw new Error("Payment requirement payload is not an object.");
  }

  const accepts = decoded.accepts || decoded.accept || decoded.paymentRequirements;
  if (Array.isArray(accepts) && accepts.length > 0 && isRecord(accepts[0])) {
    return accepts[0];
  }

  return decoded;
}

export function parsePaymentRequiredHeader(header: string): PaymentRequirement {
  const decoded = decodePaymentHeader(header);
  const requirement = findRequirementRecord(decoded);

  const scheme = getString(requirement, ["scheme"]);
  const network = getString(requirement, ["network", "chainId", "chain"]);
  const asset = getString(requirement, ["asset", "token", "currency"]);
  const amount = getString(requirement, ["amount", "maxAmountRequired", "price"]);
  const payTo = getString(requirement, ["payTo", "recipient", "to"]);

  return {
    rawHeader: header,
    decoded,
    scheme,
    network,
    asset,
    amount,
    amountBaseUnits: amount ? parseUsdcBaseUnits(amount) : undefined,
    payTo,
  };
}

export function validatePaymentRequirement(
  requirement: PaymentRequirement,
  payerAddress?: string,
): void {
  if (!requirement.rawHeader) {
    throw new Error("Missing Payment-Required header.");
  }
  if (requirement.scheme && requirement.scheme !== "exact") {
    throw new Error(`Unsupported x402 scheme: ${requirement.scheme}`);
  }
  if (!requirement.network || !X402_ALLOWED_NETWORKS.includes(requirement.network)) {
    throw new Error(
      `Unsupported network ${requirement.network}; expected one of ${X402_ALLOWED_NETWORKS.join(", ")}.`,
    );
  }
  if (!requirement.asset) {
    throw new Error("Payment requirement is missing an asset.");
  }
  const allowedAssets = X402_ALLOWED_ASSETS.map((asset) => asset.toLowerCase());
  if (!allowedAssets.includes(requirement.asset.toLowerCase())) {
    throw new Error(
      `Unsupported asset ${requirement.asset}; expected one of ${X402_ALLOWED_ASSETS.join(", ")}.`,
    );
  }
  if (!requirement.amountBaseUnits) {
    throw new Error("Payment requirement is missing an amount.");
  }
  if (requirement.amountBaseUnits > BigInt(MAX_REPORT_BASE_UNITS)) {
    throw new Error(
      `Report price ${formatUsdc(requirement.amountBaseUnits)} USDC exceeds ` +
        `${formatUsdc(BigInt(MAX_REPORT_BASE_UNITS))} USDC per-report limit.`,
    );
  }
  if (payerAddress && requirement.payTo) {
    const payer = payerAddress.toLowerCase();
    const payTo = requirement.payTo.toLowerCase();
    if (payer === payTo) {
      throw new Error("self_send_not_allowed: payer address matches author payTo address.");
    }
  }
}
