"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type AgentStage =
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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  candidates?: ReportCandidate[];
  query?: string;
  reportSlug?: string;
};

type ReportCandidate = {
  slug: string;
  title: string;
  summary?: string;
  author?: string;
  price?: string | number;
  priceUSDC?: string;
};

type AgentResponse = {
  answer: string;
  candidates?: ReportCandidate[];
  status?: {
    pactStatus?: string;
    dailyBudgetUsd?: string;
    maxReportUsd?: string;
    paymentStatus?: string;
    selectedReport?: string;
  };
};

type StreamEvent =
  | { type: "stage"; stage: AgentStage }
  | { type: "result"; payload: AgentResponse }
  | { type: "error"; error: string };

type Article = {
  slug: string;
  title: string;
  summary?: string;
  author?: string;
  authorOrg?: string;
  tags?: string[];
  price?: string;
  priceUSDC?: string;
  read?: string;
};

type HistoryEntry = {
  slug: string;
  title: string;
  author: string;
  attestationUID: string;
  savedAt: string;
  contentPath: string;
  companionPath: string;
  citationPath: string;
};

type ActivityEntry = {
  id: string;
  input: string;
  slug?: string;
  title?: string;
  author?: string;
  status: "paid" | "cached" | "not_required" | "needs_clarification" | "failed";
  error?: string;
  createdAt: string;
};

type PairingStatus = {
  paired: boolean;
  walletUuid: string | null;
  pactId: string | null;
  pactStatus: string;
  pactName?: string;
  walletId?: string;
  expiresAt?: string;
  progressTxCount?: number;
  progressUsdSpent?: string;
  supportedChains: string[];
  supportedTokens: Array<{ chain_id: string; token_id: string }>;
  missing: string[];
  error?: string;
};

const starter = "为 web3 公司工作,有什么风险?";

const REPORT_FILES = ["content.md", "companion.md", "citation.json"] as const;

function downloadHref(slug: string, file: string) {
  return `/api/downloads/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`;
}

const stageLabels: Record<AgentStage, string> = {
  idle: "Ready",
  searching: "Searching catalog",
  checking_cache: "Checking cache",
  requesting_payment: "Reading paywall",
  validating_payment: "Validating quote",
  paying: "Paying with Cobo",
  reading_report: "Reading report",
  saving_report: "Saving files",
  generating_answer: "Writing answer",
  needs_clarification: "Needs choice",
  done: "Done",
  failed: "Failed",
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "我是 Citely Reader。你可以直接问：为 web3 公司工作,有什么风险?",
    },
  ]);
  const [input, setInput] = useState(starter);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [articles, setArticles] = useState<Article[]>([]);
  const [articlesState, setArticlesState] = useState<"loading" | "ready" | "error">("loading");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [currentStage, setCurrentStage] = useState<AgentStage>("idle");
  const [pairing, setPairing] = useState<PairingStatus | null>(null);
  const [pairingState, setPairingState] = useState<"checking" | "ready" | "error">("checking");
  const [status, setStatus] = useState<AgentResponse["status"]>({
    pactStatus: "configurable",
    dailyBudgetUsd: "5.00",
    maxReportUsd: "0.50",
    paymentStatus: "idle",
  });

  const paymentsDisabled = pairing?.pactStatus === "disabled";
  const canSend = useMemo(
    () =>
      input.trim().length > 0 &&
      !isLoading &&
      (pairing?.paired === true || pairing?.pactStatus === "disabled"),
    [input, isLoading, pairing],
  );
  const buttonLabel = isLoading ? stageLabels[currentStage] : "Read";

  async function checkPairing() {
    setPairingState("checking");
    try {
      const response = await fetch("/api/pacts/status", { cache: "no-store" });
      const text = await response.text();
      let payload: PairingStatus & {
        dailyBudgetUsd?: string;
        maxReportUsd?: string;
      };
      try {
        payload = JSON.parse(text) as typeof payload;
      } catch {
        throw new Error(
          "Pairing endpoint returned a non-JSON page. Confirm you opened Citely Reader, not the x402 service, then refresh.",
        );
      }
      if (!response.ok) {
        throw new Error(payload.error || "Failed to check Cobo pairing.");
      }
      setPairing(payload);
      setStatus((current) => ({
        ...current,
        pactStatus: payload.pactStatus,
        dailyBudgetUsd: payload.dailyBudgetUsd || current?.dailyBudgetUsd,
        maxReportUsd: payload.maxReportUsd || current?.maxReportUsd,
      }));
      setPairingState("ready");
    } catch (caught) {
      setPairingState("error");
      setPairing((current) => ({
        paired: false,
        walletUuid: current?.walletUuid || null,
        pactId: current?.pactId || null,
        pactStatus: "error",
        supportedChains: current?.supportedChains || [],
        supportedTokens: current?.supportedTokens || [],
        missing: current?.missing || [],
        error: caught instanceof Error ? caught.message : "Failed to check Cobo pairing.",
      }));
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadArticles() {
      try {
        const response = await fetch("/api/reports/search");
        const payload = (await response.json()) as { articles?: Article[] };
        if (!response.ok) {
          throw new Error("Failed to load catalog.");
        }
        if (isMounted) {
          setArticles(payload.articles || []);
          setArticlesState("ready");
        }
      } catch {
        if (isMounted) {
          setArticlesState("error");
        }
      }
    }

    loadArticles();
    return () => {
      isMounted = false;
    };
  }, []);

  async function refreshHistory() {
    const response = await fetch("/api/history");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      history?: HistoryEntry[];
      activity?: ActivityEntry[];
    };
    setHistory(payload.history || []);
    setActivity(payload.activity || []);
  }

  useEffect(() => {
    refreshHistory();
    checkPairing();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;

    setError("");
    setIsLoading(true);
    setCurrentStage("searching");
    setInput("");
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: text },
    ]);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Citely Reader request failed.");
      }
      if (!response.body) {
        throw new Error("Citely Reader response stream is unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let payload: AgentResponse | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === "stage") {
            setCurrentStage(event.stage);
          }
          if (event.type === "result") {
            payload = event.payload;
          }
          if (event.type === "error") {
            throw new Error(event.error);
          }
        }
      }

      if (buffer.trim()) {
        const event = JSON.parse(buffer) as StreamEvent;
        if (event.type === "stage") {
          setCurrentStage(event.stage);
        }
        if (event.type === "result") {
          payload = event.payload;
        }
        if (event.type === "error") {
          throw new Error(event.error);
        }
      }

      if (!payload) {
        throw new Error("Citely Reader finished without an answer.");
      }

      setStatus(payload.status);
      const savedSlug =
        payload.status?.selectedReport &&
        ["paid", "cached", "not_required"].includes(payload.status.paymentStatus || "")
          ? payload.status.selectedReport
          : undefined;
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: payload.answer,
          candidates: payload.candidates,
          query: text,
          reportSlug: savedSlug,
        },
      ]);
      refreshHistory();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown error";
      setCurrentStage("failed");
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `请求失败：${message}`,
        },
      ]);
    } finally {
      setIsLoading(false);
      setCurrentStage((stage) => (stage === "failed" ? "failed" : "idle"));
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">CR</div>
          <div>
            <h1>Citely Reader</h1>
            <p>x402 paid-report agent</p>
          </div>
        </div>

        <section className={`pairing-panel ${pairing?.paired ? "paired" : "unpaired"}`}>
          <div className="pairing-head">
            <div>
              <h2>Pairing</h2>
              <p>
                {paymentsDisabled
                  ? "Payments disabled — paid reports unavailable"
                  : pairing?.paired
                    ? "Wallet and pact confirmed"
                    : "Wallet and pact required"}
              </p>
            </div>
            <span className={`badge ${pairing?.paired ? "ok" : "warn"}`}>
              {pairingState === "checking" ? "checking" : pairing?.pactStatus || "unknown"}
            </span>
          </div>

          <dl className="pairing-details">
            <div>
              <dt>Wallet</dt>
              <dd>{pairing?.walletUuid || "not set"}</dd>
            </div>
            <div>
              <dt>Pact</dt>
              <dd>{pairing?.pactName || pairing?.pactId || "not set"}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{pairing?.supportedChains?.join(", ") || "unknown"}</dd>
            </div>
            {pairing?.expiresAt ? (
              <div>
                <dt>Expires</dt>
                <dd>{new Date(pairing.expiresAt).toLocaleString()}</dd>
              </div>
            ) : null}
            {typeof pairing?.progressTxCount === "number" ? (
              <div>
                <dt>Used</dt>
                <dd>{pairing.progressTxCount} payments</dd>
              </div>
            ) : null}
          </dl>

          {pairing?.missing.length ? (
            <p className="pairing-warning">Missing: {pairing.missing.join(", ")}</p>
          ) : null}
          {pairing?.error ? <p className="pairing-warning">{pairing.error}</p> : null}

          <button type="button" className="pairing-button" onClick={checkPairing}>
            {pairingState === "checking" ? "Checking" : "Check Pairing"}
          </button>
        </section>

        <div className="status-group" aria-label="Agent status">
          <div className="status-row">
            <span>Pact</span>
            <b>{status?.pactStatus || "unknown"}</b>
          </div>
          <div className="status-row">
            <span>Daily budget</span>
            <b>{status?.dailyBudgetUsd || "5.00"} USDC</b>
          </div>
          <div className="status-row">
            <span>Per report</span>
            <b>{status?.maxReportUsd || "0.50"} USDC</b>
          </div>
          <div className="status-row">
            <span>Payment</span>
            <span className={`badge ${status?.paymentStatus === "paid" ? "ok" : "warn"}`}>
              {status?.paymentStatus || "idle"}
            </span>
          </div>
          <div className="status-row">
            <span>Stage</span>
            <b>{stageLabels[currentStage]}</b>
          </div>
        </div>

        <p className="hint">
          Citely Reader searches the free x402write catalog, pays exact x402
          requirements through Cobo Agentic Wallet when allowed by the active pact,
          and answers only from purchased content.
        </p>

        <section className="catalog" aria-label="Available reports">
          <div className="catalog-head">
            <h2>Reports</h2>
            <span>{articlesState === "ready" ? articles.length : ""}</span>
          </div>

          {articlesState === "loading" ? (
            <p className="catalog-note">Loading catalog...</p>
          ) : null}

          {articlesState === "error" ? (
            <p className="catalog-note">Catalog unavailable.</p>
          ) : null}

          {articlesState === "ready" ? (
            <div className="catalog-list">
              {articles.map((article) => (
                <button
                  key={article.slug}
                  type="button"
                  className="catalog-item"
                  onClick={() => setInput(`请阅读 ${article.slug} 并总结`)}
                >
                  <span className="catalog-title">{article.title}</span>
                  <span className="catalog-meta">
                    {article.author || "Unknown"}
                    {article.price ? ` · ${article.price}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="catalog" aria-label="Read history">
          <div className="catalog-head">
            <h2>History</h2>
            <a className="inline-link" href="/history">
              View all
            </a>
          </div>

          {history.length === 0 ? (
            <p className="catalog-note">No paid reads yet.</p>
          ) : (
            <div className="catalog-list">
              {history.slice(0, 3).map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  className="catalog-item"
                  onClick={() => setInput(`请基于 ${item.slug} 再解释一次`)}
                >
                  <span className="catalog-title">{item.title}</span>
                  <span className="catalog-meta">
                    {item.author} · {item.attestationUID.slice(0, 10)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="catalog" aria-label="Payment activity">
          <div className="catalog-head">
            <h2>Activity</h2>
            <span>{activity.length || ""}</span>
          </div>

          {activity.length === 0 ? (
            <p className="catalog-note">No payment activity yet.</p>
          ) : (
            <div className="activity-list">
              {activity.slice(0, 4).map((item) => (
                <div key={item.id} className="activity-item">
                  <span className={`activity-dot ${item.status}`} />
                  <div>
                    <b>{item.title || item.slug || item.input}</b>
                    <span>
                      {item.status}
                      {item.error ? ` · ${item.error}` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

      <main className="main">
        <section className="conversation" aria-live="polite">
          <div className="message-list">
            {messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <strong>{message.role === "user" ? "You" : "Citely Reader"}</strong>
                <pre>{message.content}</pre>
                {message.candidates?.length ? (
                  <div className="candidate-list">
                    {message.candidates.map((candidate) => (
                      <button
                        key={candidate.slug}
                        type="button"
                        className="candidate-button"
                        onClick={() =>
                          setInput(`请阅读 ${candidate.slug}，并回答：${message.query || ""}`)
                        }
                      >
                        <span>{candidate.title}</span>
                        <small>
                          {candidate.slug}
                          {candidate.price ? ` · ${candidate.price}` : ""}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : null}
                {message.reportSlug ? (
                  <div className="report-files">
                    <span className="report-files-label">
                      已保存到服务器 downloads/{message.reportSlug}/
                    </span>
                    <div className="report-files-links">
                      {REPORT_FILES.map((file) => (
                        <a
                          key={file}
                          className="report-file-link"
                          href={downloadHref(message.reportSlug!, file)}
                          download
                        >
                          {file}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="composer-wrap">
          <form className="composer" onSubmit={onSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="为 web3 公司工作,有什么风险?"
              aria-label="Message"
            />
            <button type="submit" disabled={!canSend}>
              {buttonLabel}
            </button>
          </form>
          {isLoading ? (
            <div className="stage-strip" aria-live="polite">
              <span className="stage-pulse" />
              {stageLabels[currentStage]}
            </div>
          ) : null}
          {error ? <div className="error">{error}</div> : null}
        </section>
      </main>
    </div>
  );
}
