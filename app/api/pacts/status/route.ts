import { NextResponse } from "next/server";
import {
  DAILY_BUDGET_USDC,
  DAILY_PAYMENT_LIMIT,
  MAX_REPORT_USDC,
} from "@/lib/config";
import { getCoboPairingStatus } from "@/lib/cobo";

export async function GET() {
  const pairing = await getCoboPairingStatus();
  return NextResponse.json({
    ...pairing,
    pactStatus: pairing.pactStatus,
    maxReportUsd: MAX_REPORT_USDC.toFixed(2),
    dailyBudgetUsd: DAILY_BUDGET_USDC.toFixed(2),
    dailyPaymentLimit: DAILY_PAYMENT_LIMIT,
    note: pairing.paired
      ? "Cobo wallet and pact are paired for Citely Reader."
      : "Pairing is required before paid reads.",
  });
}
