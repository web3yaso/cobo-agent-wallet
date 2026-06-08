import type { PaidReport } from "./types";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

function citationLine(report: PaidReport): string {
  const uid = report.citation.attestationUID || "";
  return `来源:${report.citation.author}，链上存证 EAS ${uid.slice(0, 10)}`;
}

export function formatRiskAnswer(report: PaidReport, userQuestion: string): string {
  return [
    `## ${report.title}`,
    "",
    `你问的是：${userQuestion}`,
    "",
    "我已经读取了付费报告正文和 companion。下面的回答必须以报告内容为准；如果需要更细的法律适用，应该让有资质的专业人士结合具体事实判断。",
    "",
    "### 报告正文",
    report.content,
    "",
    "### Companion",
    report.companion,
    "",
    citationLine(report),
    "",
    "这是风险教育，不构成法律意见；具体情况请咨询有资质的专业人士。",
  ].join("\n");
}

export async function generateRiskAnswer(
  report: PaidReport,
  userQuestion: string,
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return formatRiskAnswer(report, userQuestion);
  }

  const { text } = await generateText({
    model: openai(process.env.OPENAI_MODEL || "gpt-4o-mini"),
    system:
      "You are Citely Reader, an x402 paid-report reading agent. " +
      "Answer in Chinese. Ground every claim in the provided paid report content " +
      "and companion only. Do not invent legal conclusions. This is risk education, " +
      "not legal advice.",
    prompt: [
      `User question: ${userQuestion}`,
      "",
      `Report title: ${report.title}`,
      `Author: ${report.citation.author}`,
      `EAS attestation UID: ${report.citation.attestationUID}`,
      "",
      "Paid content:",
      report.content,
      "",
      "Companion:",
      report.companion,
      "",
      "Write a structured answer with: summary, key risks, glossary/legal map from companion, misconceptions, and required disclaimer.",
      `End with: 来源:${report.citation.author}，链上存证 EAS ${report.citation.attestationUID.slice(0, 10)}`,
      "Also include: 这是风险教育，不构成法律意见；具体情况请咨询有资质的专业人士。",
    ].join("\n"),
  });

  return text;
}
