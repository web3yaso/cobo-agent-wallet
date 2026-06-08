import { readJson, writeJson } from "./storage";
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

const HISTORY_KEY = "history.json";
const ACTIVITY_KEY = "activity.json";

export async function readReportHistory(): Promise<ReportHistoryEntry[]> {
  return readJson<ReportHistoryEntry[]>(HISTORY_KEY, []);
}

export async function readReportActivity(): Promise<ReportActivityEntry[]> {
  return readJson<ReportActivityEntry[]>(ACTIVITY_KEY, []);
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
  await writeJson(ACTIVITY_KEY, next);
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
  await writeJson(HISTORY_KEY, next);
  return next;
}
