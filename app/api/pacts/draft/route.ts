import { NextResponse } from "next/server";
import { buildCitelyReaderPactDraft } from "@/lib/cobo";

export async function GET() {
  return NextResponse.json(buildCitelyReaderPactDraft());
}
