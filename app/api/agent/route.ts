import { NextRequest, NextResponse } from "next/server";
import { DAILY_BUDGET_USDC, MAX_REPORT_USDC } from "@/lib/config";
import { cawFetchX402 } from "@/lib/cobo";
import { generateRiskAnswer } from "@/lib/answer";
import { recordReportActivity } from "@/lib/report-history";
import { MultipleReportsMatchError, readPaidReport } from "@/lib/x402write";
import type { AgentStage } from "@/lib/types";

type AgentRequest = {
  message?: string;
  payerAddress?: string;
};

type StreamEvent =
  | { type: "stage"; stage: AgentStage }
  | { type: "result"; payload: unknown }
  | { type: "error"; error: string };

function baseStatus(paymentStatus: string, selectedReport?: string) {
  return {
    pactStatus: process.env.COBO_PACT_ID ? "configured" : "draft",
    dailyBudgetUsd: DAILY_BUDGET_USDC.toFixed(2),
    maxReportUsd: MAX_REPORT_USDC.toFixed(2),
    paymentStatus,
    selectedReport,
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as AgentRequest;
  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: StreamEvent) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }

      try {
        const result = await readPaidReport(
          message,
          (requirement, readUrl) => cawFetchX402(readUrl, requirement),
          body.payerAddress,
          (stage) => send({ type: "stage", stage }),
        );

        send({ type: "stage", stage: "generating_answer" });
        const answer = await generateRiskAnswer(result.report, message);
        await recordReportActivity({
          input: message,
          slug: result.report.slug,
          title: result.report.title,
          author: result.report.citation.author,
          status: result.paymentStatus,
        });

        send({ type: "stage", stage: "done" });
        send({
          type: "result",
          payload: {
            answer,
            status: baseStatus(
              result.paymentStatus,
              result.selectedReport?.slug || result.report.slug,
            ),
          },
        });
      } catch (caught) {
        if (caught instanceof MultipleReportsMatchError) {
          const candidates = caught.candidates;
          await recordReportActivity({
            input: message,
            status: "needs_clarification",
            error: "Multiple reports matched; waiting for user selection.",
          });

          send({ type: "stage", stage: "needs_clarification" });
          send({
            type: "result",
            payload: {
              answer: [
                "我找到了多篇可能相关的报告。为了避免误付费，我先不发起 x402 支付。",
                "",
                "你想读哪一篇？可以点击候选，或直接输入对应 slug：",
                ...candidates.map((item, index) => {
                  const meta = [item.slug, item.author, item.price ? `${item.price}` : undefined]
                    .filter(Boolean)
                    .join(" · ");
                  return `${index + 1}. ${item.title} (${meta})`;
                }),
              ].join("\n"),
              candidates,
              status: baseStatus("needs_clarification"),
            },
          });
          return;
        }

        const error = caught instanceof Error ? caught.message : "Unknown agent error";
        await recordReportActivity({
          input: message,
          status: "failed",
          error,
        });
        send({ type: "stage", stage: "failed" });
        send({ type: "error", error });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
