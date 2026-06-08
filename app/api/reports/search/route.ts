import { NextRequest, NextResponse } from "next/server";
import { searchReports } from "@/lib/x402write";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || undefined;
  const articles = await searchReports(query);
  return NextResponse.json({ articles });
}
