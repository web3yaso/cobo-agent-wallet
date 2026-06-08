export type ArticleCatalogItem = {
  slug: string;
  title: string;
  description?: string;
  summary?: string;
  author?: string;
  authorOrg?: string;
  tags?: string[];
  price?: string | number;
  priceUSDC?: string;
  read?: string;
};

export type ReportCandidate = Pick<
  ArticleCatalogItem,
  "slug" | "title" | "summary" | "author" | "price" | "priceUSDC"
>;

export type ReportCitation = {
  author: string;
  attestationUID: string;
  publishedAt?: string;
};

export type PaidReport = {
  slug: string;
  title: string;
  content: string;
  companion: string;
  citation: ReportCitation;
};

export type PaymentRequirement = {
  rawHeader: string;
  decoded: unknown;
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  amountBaseUnits?: bigint;
  payTo?: string;
};

export type AgentStage =
  | "idle"
  | "searching"
  | "checking_cache"
  | "requesting_payment"
  | "validating_payment"
  | "paying"
  | "reading_report"
  | "saving_report"
  | "generating_answer"
  | "needs_clarification"
  | "done"
  | "failed";

export type ReadPaidReportResult = {
  report: PaidReport;
  source: "cache" | "paid" | "free";
  selectedReport?: ArticleCatalogItem;
  paymentStatus: "cached" | "paid" | "not_required";
};
