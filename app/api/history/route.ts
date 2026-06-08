import { NextResponse } from "next/server";
import { readReportActivity, readReportHistory } from "@/lib/report-history";

export async function GET() {
  const history = await readReportHistory();
  const activity = await readReportActivity();
  return NextResponse.json({ history, activity });
}
