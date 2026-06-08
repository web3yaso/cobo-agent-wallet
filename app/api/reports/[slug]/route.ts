import { NextRequest, NextResponse } from "next/server";
import { cawFetchX402 } from "@/lib/cobo";
import { readPaidReport } from "@/lib/x402write";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  try {
    const payerAddress = request.nextUrl.searchParams.get("payerAddress") || undefined;
    const result = await readPaidReport(
      slug,
      (requirement, readUrl) => cawFetchX402(readUrl, requirement),
      payerAddress,
    );
    return NextResponse.json(result);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown report error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
