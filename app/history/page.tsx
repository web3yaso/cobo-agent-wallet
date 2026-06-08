import Link from "next/link";
import { readReportActivity, readReportHistory } from "@/lib/report-history";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function downloadHref(slug: string, file: string) {
  return `/api/downloads/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`;
}

export default async function HistoryPage() {
  const history = await readReportHistory();
  const activity = await readReportActivity();

  return (
    <main className="history-page">
      <div className="history-top">
        <div>
          <h1>History</h1>
          <p>Paid reports saved by Citely Reader, followed by the activity log.</p>
        </div>
        <Link href="/">Back</Link>
      </div>

      <section className="history-section">
        <h2>Saved Reports</h2>
        {history.length === 0 ? (
          <div className="history-empty">No paid reports saved yet.</div>
        ) : (
          <div className="history-list">
            {history.map((item) => (
              <article key={item.slug} className="history-card">
                <div>
                  <h2>{item.title}</h2>
                  <p>
                    {item.author} · {formatDate(item.savedAt)}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Slug</dt>
                    <dd>{item.slug}</dd>
                  </div>
                  <div>
                    <dt>EAS</dt>
                    <dd>{item.attestationUID.slice(0, 10)}</dd>
                  </div>
                  <div>
                    <dt>Content</dt>
                    <dd>
                      <a href={downloadHref(item.slug, "content.md")}>Download content.md</a>
                    </dd>
                  </div>
                  <div>
                    <dt>Companion</dt>
                    <dd>
                      <a href={downloadHref(item.slug, "companion.md")}>
                        Download companion.md
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Citation</dt>
                    <dd>
                      <a href={downloadHref(item.slug, "citation.json")}>
                        Download citation.json
                      </a>
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="history-section">
        <h2>Activity Log</h2>
        {activity.length === 0 ? (
          <div className="history-empty">No activity yet.</div>
        ) : (
          <div className="activity-panel">
            {activity.map((item) => (
              <article key={item.id} className="activity-row">
                <span className={`activity-badge ${item.status}`}>{item.status}</span>
                <div>
                  <b>{item.title || item.slug || item.input}</b>
                  <p>
                    {formatDate(item.createdAt)}
                    {item.author ? ` · ${item.author}` : ""}
                  </p>
                  {item.error ? <p className="activity-error">{item.error}</p> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
