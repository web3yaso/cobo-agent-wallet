import { REPORT_CACHE_TTL_SECONDS } from "./config";
import type { PaidReport } from "./types";

type CacheEntry = {
  report: PaidReport;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

export function getCachedReport(slug: string): PaidReport | undefined {
  const entry = cache.get(slug);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(slug);
    return undefined;
  }
  return entry.report;
}

export function setCachedReport(report: PaidReport): void {
  cache.set(report.slug, {
    report,
    expiresAt: Date.now() + REPORT_CACHE_TTL_SECONDS * 1000,
  });
}

export function getCacheStatus(slug: string): "hit" | "miss" {
  return getCachedReport(slug) ? "hit" : "miss";
}
