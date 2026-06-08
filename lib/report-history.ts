import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PaidReport } from "./types";

export type ReportHistoryEntry = {
  slug: string;
  title: string;
  author: string;
  attestationUID: string;
  savedAt: string;
  contentPath: string;
  companionPath: string;
  citationPath: string;
};

export type ReportActivityEntry = {
  id: string;
  input: string;
  slug?: string;
  title?: string;
  author?: string;
  status: "paid" | "cached" | "not_required" | "needs_clarification" | "failed";
  error?: string;
  createdAt: string;
};

const DOWNLOAD_ROOT = "downloads";
const HISTORY_PATH = join(process.cwd(), DOWNLOAD_ROOT, "history.json");
const ACTIVITY_PATH = join(process.cwd(), DOWNLOAD_ROOT, "activity.json");

export async function readReportHistory(): Promise<ReportHistoryEntry[]> {
  try {
    const contents = await readFile(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(contents) as unknown;
    return Array.isArray(parsed) ? (parsed as ReportHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function readReportActivity(): Promise<ReportActivityEntry[]> {
  try {
    const contents = await readFile(ACTIVITY_PATH, "utf8");
    const parsed = JSON.parse(contents) as unknown;
    return Array.isArray(parsed) ? (parsed as ReportActivityEntry[]) : [];
  } catch {
    return [];
  }
}

export async function recordReportActivity(
  entry: Omit<ReportActivityEntry, "id" | "createdAt">,
): Promise<ReportActivityEntry[]> {
  const activity = await readReportActivity();
  const nextEntry: ReportActivityEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
  };
  const next = [nextEntry, ...activity].slice(0, 50);
  await mkdir(join(process.cwd(), DOWNLOAD_ROOT), { recursive: true });
  await writeFile(ACTIVITY_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function recordReportHistory(
  report: PaidReport,
  paths: {
    contentPath: string;
    companionPath: string;
    citationPath: string;
  },
): Promise<ReportHistoryEntry[]> {
  const history = await readReportHistory();
  const entry: ReportHistoryEntry = {
    slug: report.slug,
    title: report.title,
    author: report.citation.author,
    attestationUID: report.citation.attestationUID,
    savedAt: new Date().toISOString(),
    contentPath: paths.contentPath,
    companionPath: paths.companionPath,
    citationPath: paths.citationPath,
  };

  const next = [entry, ...history.filter((item) => item.slug !== report.slug)];
  await mkdir(join(process.cwd(), DOWNLOAD_ROOT), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}
