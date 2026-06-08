import { X402_ARTICLE_PATH_PREFIX, X402WRITE_BASE_URL } from "./config";
import {
  parsePaymentRequiredHeader,
  validatePaymentRequirement,
} from "./payment-requirements";
import { getCachedReport, setCachedReport } from "./report-cache";
import { saveReportFiles } from "./report-files";
import type {
  AgentStage,
  ArticleCatalogItem,
  PaidReport,
  PaymentRequirement,
  ReportCandidate,
  ReadPaidReportResult,
} from "./types";

export class MultipleReportsMatchError extends Error {
  candidates: ReportCandidate[];

  constructor(candidates: ArticleCatalogItem[]) {
    super("Multiple reports match this request.");
    this.name = "MultipleReportsMatchError";
    this.candidates = candidates.slice(0, 5).map((item) => ({
      slug: item.slug,
      title: item.title,
      summary: item.summary || item.description,
      author: item.author,
      price: item.price,
      priceUSDC: item.priceUSDC,
    }));
  }
}

function buildUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return new URL(path, X402WRITE_BASE_URL).toString();
}

async function fetchEndpoint(url: string, context: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`${context} fetch failed for ${url}: ${message}`);
  }
}

function getReadPath(article: ArticleCatalogItem): string {
  const prefix = X402_ARTICLE_PATH_PREFIX.replace(/\/$/, "");
  if (prefix !== "/api/v1/articles") {
    return `${prefix}/${article.slug}`;
  }
  return article.read || `/api/v1/articles/${article.slug}`;
}

export function extractSlug(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/api\/v1\/articles\/([^/]+)/);
    if (match) return decodeURIComponent(match[1]);
    const last = url.pathname.split("/").filter(Boolean).pop();
    if (last && /^[a-z0-9-]+$/i.test(last)) return last;
  } catch {
    // Not a URL.
  }

  const slugMatch = trimmed.match(/\b[a-z0-9]+(?:-[a-z0-9]+){1,}\b/i);
  return slugMatch?.[0];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function tokenizeQuery(query: string): string[] {
  const normalized = normalizeText(query);
  const tokens = new Set<string>();
  const aliases: Record<string, string[]> = {
    web3: ["web3", "crypto", "虚拟货币", "链上", "dao", "rwa"],
    公司: ["公司", "雇主", "企业", "用工"],
    工作: ["工作", "劳动", "雇佣", "用工", "发薪", "远程"],
    风险: ["风险", "违法", "合规", "法律", "法院", "责任"],
    刑事: ["刑事", "执法", "责任", "危险", "定责"],
    rwa: ["rwa", "资产", "治理", "合伙", "dao"],
  };

  for (const char of normalized) {
    if (/[\u4e00-\u9fff]/.test(char)) tokens.add(char);
  }

  for (const word of normalized.match(/[a-z0-9]+/g) || []) {
    tokens.add(word);
  }

  for (const [trigger, expansions] of Object.entries(aliases)) {
    if (normalized.includes(trigger)) {
      for (const expansion of expansions) tokens.add(normalizeText(expansion));
    }
  }

  return [...tokens].filter((token) => token.length > 0);
}

function articleSearchText(article: ArticleCatalogItem): string {
  return normalizeText(
    [
      article.slug,
      article.title,
      article.description,
      article.summary,
      article.author,
      article.authorOrg,
      ...(article.tags || []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function rankReports(
  query: string,
  articles: ArticleCatalogItem[],
): ArticleCatalogItem[] {
  const normalizedQuery = normalizeText(query);
  const tokens = tokenizeQuery(query);

  return articles
    .map((article) => {
      const haystack = articleSearchText(article);
      let score = 0;

      if (haystack.includes(normalizedQuery)) score += 20;
      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += token.length > 1 ? 4 : 1;
        }
      }

      return { article, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.article);
}

async function fetchCatalog(query?: string): Promise<ArticleCatalogItem[]> {
  const url = new URL("/api/v1/articles", X402WRITE_BASE_URL);
  if (query?.trim()) {
    url.searchParams.set("q", query.trim());
  }

  const response = await fetchEndpoint(url.toString(), "x402write catalog", {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`x402write catalog search failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload)) return payload as ArticleCatalogItem[];
  if (Array.isArray(payload.articles)) return payload.articles as ArticleCatalogItem[];
  if (Array.isArray(payload.items)) return payload.items as ArticleCatalogItem[];
  return [];
}

export async function searchReports(query?: string): Promise<ArticleCatalogItem[]> {
  if (!query?.trim()) {
    return fetchCatalog();
  }

  const direct = await fetchCatalog(query);
  if (direct.length > 0) {
    return direct;
  }

  const all = await fetchCatalog();
  return rankReports(query, all);
}

export async function resolveReport(input: string): Promise<ArticleCatalogItem> {
  const explicitSlug = extractSlug(input);
  if (explicitSlug) {
    return {
      slug: explicitSlug,
      title: explicitSlug,
      read: `${X402_ARTICLE_PATH_PREFIX.replace(/\/$/, "")}/${explicitSlug}`,
    };
  }

  const candidates = await searchReports(input);
  if (candidates.length === 0) {
    throw new Error("No matching x402write reports found.");
  }
  if (candidates.length > 1) {
    throw new MultipleReportsMatchError(candidates);
  }

  return candidates[0];
}

function getPaymentRequiredHeader(response: Response): string | null {
  return (
    response.headers.get("Payment-Required") ||
    response.headers.get("payment-required") ||
    response.headers.get("X-Payment-Required")
  );
}

export async function getReportPaymentRequirements(
  article: ArticleCatalogItem,
): Promise<{
  requirement: PaymentRequirement;
  readUrl: string;
}> {
  const readPath = getReadPath(article);
  const readUrl = buildUrl(readPath);
  const response = await fetchEndpoint(readUrl, "x402write payment requirement", {
    cache: "no-store",
  });

  if (response.status !== 402) {
    if (response.ok) {
      throw new Error("Report was returned without payment; use readPaidReport instead.");
    }
    throw new Error(`x402write report request failed: HTTP ${response.status}`);
  }

  const header = getPaymentRequiredHeader(response);
  if (!header) {
    throw new Error("x402write returned 402 without Payment-Required header.");
  }

  return {
    requirement: parsePaymentRequiredHeader(header),
    readUrl,
  };
}

async function parsePaidReport(response: Response): Promise<PaidReport> {
  const payload = await response.json();
  if (
    !payload ||
    typeof payload.slug !== "string" ||
    typeof payload.title !== "string" ||
    typeof payload.content !== "string" ||
    typeof payload.companion !== "string" ||
    !payload.citation
  ) {
    throw new Error("Paid report response is missing required fields.");
  }
  return payload as PaidReport;
}

export async function readPaidReport(
  input: string,
  pay: (requirement: PaymentRequirement, readUrl: string) => Promise<string>,
  payerAddress?: string,
  onStage?: (stage: AgentStage) => void,
): Promise<ReadPaidReportResult> {
  onStage?.("searching");
  const article = await resolveReport(input);
  onStage?.("checking_cache");
  const cached = getCachedReport(article.slug);
  if (cached) {
    onStage?.("saving_report");
    await saveReportFiles(cached);
    return {
      report: cached,
      selectedReport: article,
      source: "cache",
      paymentStatus: "cached",
    };
  }

  const readPath = getReadPath(article);
  const readUrl = buildUrl(readPath);
  onStage?.("requesting_payment");
  const initial = await fetchEndpoint(readUrl, "x402write article", { cache: "no-store" });

  if (initial.ok) {
    onStage?.("reading_report");
    const report = await parsePaidReport(initial);
    setCachedReport(report);
    onStage?.("saving_report");
    await saveReportFiles(report);
    return {
      report,
      selectedReport: article,
      source: "free",
      paymentStatus: "not_required",
    };
  }

  if (initial.status !== 402) {
    throw new Error(`x402write report request failed: HTTP ${initial.status}`);
  }

  const paymentHeader = getPaymentRequiredHeader(initial);
  if (!paymentHeader) {
    throw new Error("x402write returned 402 without Payment-Required header.");
  }

  const requirement = parsePaymentRequiredHeader(paymentHeader);
  onStage?.("validating_payment");
  validatePaymentRequirement(requirement, payerAddress);
  onStage?.("paying");
  const paymentResult = await pay(requirement, readUrl);

  try {
    const report = JSON.parse(paymentResult) as PaidReport;
    if (report?.slug && report?.content && report?.companion && report?.citation) {
      setCachedReport(report);
      onStage?.("saving_report");
      await saveReportFiles(report);
      return {
        report,
        selectedReport: article,
        source: "paid",
        paymentStatus: "paid",
      };
    }
  } catch {
    // Some payment adapters return only a retry header; fall through to manual retry.
  }

  onStage?.("reading_report");
  const retry = await fetchEndpoint(readUrl, "x402write paid retry", {
    cache: "no-store",
    headers: {
      "PAYMENT-SIGNATURE": paymentResult,
    },
  });

  if (retry.status === 402) {
    const reason = getPaymentRequiredHeader(retry) || "No settlement reason returned.";
    throw new Error(`x402 settlement failed after payment: ${reason}`);
  }
  if (!retry.ok) {
    throw new Error(`x402write paid retry failed: HTTP ${retry.status}`);
  }

  const report = await parsePaidReport(retry);
  setCachedReport(report);
  onStage?.("saving_report");
  await saveReportFiles(report);
  return {
    report,
    selectedReport: article,
    source: "paid",
    paymentStatus: "paid",
  };
}
