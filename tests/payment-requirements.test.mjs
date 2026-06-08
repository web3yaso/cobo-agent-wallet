import assert from "node:assert/strict";
import test from "node:test";

const { parsePaymentRequiredHeader, validatePaymentRequirement } = await import(
  "../lib/payment-requirements.ts"
);

function header(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SOLANA_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

test("accepts exact Base mainnet USDC payment under 0.50 USDC", () => {
  const requirement = parsePaymentRequiredHeader(
    header({
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          asset: BASE_USDC,
          amount: "300000",
          payTo: "0x0000000000000000000000000000000000000001",
        },
      ],
    }),
  );

  assert.equal(requirement.network, "eip155:8453");
  assert.equal(requirement.amountBaseUnits, 300000n);
  assert.doesNotThrow(() =>
    validatePaymentRequirement(
      requirement,
      "0x0000000000000000000000000000000000000002",
    ),
  );
});

test("accepts exact Solana Devnet USDC payment under 0.50 USDC", () => {
  const requirement = parsePaymentRequiredHeader(
    header({
      accepts: [
        {
          scheme: "exact",
          network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
          asset: SOLANA_DEVNET_USDC,
          amount: "250000",
          payTo: "2vZsoMsTDJYXm2g6d9ZWiSpXjuzFw6cQhnyNwVMy2URD",
        },
      ],
    }),
  );

  assert.equal(requirement.network, "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  assert.equal(requirement.amountBaseUnits, 250000n);
  assert.doesNotThrow(() => validatePaymentRequirement(requirement));
});

test("rejects reports above 0.50 USDC", () => {
  const requirement = parsePaymentRequiredHeader(
    header({
      scheme: "exact",
      network: "eip155:8453",
      asset: BASE_USDC,
      amount: "510000",
      payTo: "0x0000000000000000000000000000000000000001",
    }),
  );

  assert.throws(() => validatePaymentRequirement(requirement), /exceeds/);
});

test("rejects self-send", () => {
  const requirement = parsePaymentRequiredHeader(
    header({
      scheme: "exact",
      network: "eip155:8453",
      asset: BASE_USDC,
      amount: "250000",
      payTo: "0x0000000000000000000000000000000000000001",
    }),
  );

  assert.throws(
    () =>
      validatePaymentRequirement(
        requirement,
        "0x0000000000000000000000000000000000000001",
      ),
    /self_send_not_allowed/,
  );
});
