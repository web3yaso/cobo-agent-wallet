import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recordReportHistory } from "./report-history";
import type { PaidReport } from "./types";

const DOWNLOAD_ROOT = "downloads";

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export async function saveReportFiles(report: PaidReport): Promise<{
  contentPath: string;
  companionPath: string;
  citationPath: string;
}> {
  const slug = safeSegment(report.slug);
  const dir = join(process.cwd(), DOWNLOAD_ROOT, slug);
  const contentPath = join(dir, "content.md");
  const companionPath = join(dir, "companion.md");
  const citationPath = join(dir, "citation.json");

  await mkdir(dir, { recursive: true });
  await writeFile(contentPath, report.content, "utf8");
  await writeFile(companionPath, report.companion, "utf8");
  await writeFile(citationPath, JSON.stringify(report.citation, null, 2), "utf8");

  const paths = {
    contentPath,
    companionPath,
    citationPath,
  };
  await recordReportHistory(report, paths);
  return paths;
}
