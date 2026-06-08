import { recordReportHistory } from "./report-history";
import { putObject } from "./storage";
import type { PaidReport } from "./types";

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export async function saveReportFiles(report: PaidReport): Promise<{
  contentPath: string;
  companionPath: string;
  citationPath: string;
}> {
  const slug = safeSegment(report.slug);
  const contentPath = `${slug}/content.md`;
  const companionPath = `${slug}/companion.md`;
  const citationPath = `${slug}/citation.json`;

  await Promise.all([
    putObject(contentPath, report.content, "text/markdown; charset=utf-8"),
    putObject(companionPath, report.companion, "text/markdown; charset=utf-8"),
    putObject(
      citationPath,
      JSON.stringify(report.citation, null, 2),
      "application/json; charset=utf-8",
    ),
  ]);

  const paths = {
    contentPath,
    companionPath,
    citationPath,
  };
  await recordReportHistory(report, paths);
  return paths;
}
