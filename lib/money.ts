import { USDC_DECIMALS } from "./config";

export function parseUsdcBaseUnits(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return BigInt(Math.round(value * 10 ** USDC_DECIMALS));
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }

  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid USDC amount: ${value}`);
  }

  const whole = match[1];
  const fraction = (match[2] || "").padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fraction || "0");
}

export function formatUsdc(baseUnits: bigint): string {
  const scale = BigInt(10 ** USDC_DECIMALS);
  const whole = baseUnits / scale;
  const fraction = (baseUnits % scale).toString().padStart(USDC_DECIMALS, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
}
