import { type FormEvent, useEffect, useState } from "react";
import {
  changeImportStatus,
  getImportHistory,
  type ImportBatch,
  type ImportPreview,
  type StageCsvInput,
  stageCsvForPreview,
} from "../api/imports.js";

interface ImportsPageProps {
  organizationId: string;
  stageForPreview?: (input: StageCsvInput) => Promise<ImportPreview>;
  changeStatus?: (
    batchId: string,
    organizationId: string,
    action: "commit" | "approve",
  ) => Promise<Omit<ImportPreview, "rows">>;
  readFile?: (file: File) => Promise<string>;
  loadHistory?: (organizationId: string) => Promise<ImportBatch[]>;
}

const defaultReadFile = (file: File) => file.text();

function displayStatus(status: ImportPreview["status"]): string {
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

export function ImportsPage({
  organizationId,
  stageForPreview = stageCsvForPreview,
  changeStatus = changeImportStatus,
  readFile = defaultReadFile,
  loadHistory = getImportHistory,
}: ImportsPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [defaultCallingCode, setDefaultCallingCode] = useState("91");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadHistory(organizationId)
      .then((items) => {
        if (!cancelled) setHistory(items);
      })
      .catch(() => {
        if (!cancelled) setHistoryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadHistory, organizationId]);

  const submitPreview = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("Choose a CSV file first");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const csv = await readFile(file);
      setPreview(
        await stageForPreview({
          organizationId,
          filename: file.name,
          defaultCallingCode,
          csv,
        }),
      );
    } catch {
      setError("The CSV could not be staged. Check the file and try again.");
    } finally {
      setBusy(false);
    }
  };

  const transition = async (action: "commit" | "approve") => {
    if (!preview) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const batch = await changeStatus(preview.id, organizationId, action);
      setPreview((current) => (current ? { ...current, ...batch, rows: current.rows } : null));
    } catch {
      setError(`The import could not be ${action === "commit" ? "committed" : "approved"}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="imports-page" aria-labelledby="imports-title">
      <header className="page-heading">
        <div>
          <p className="eyebrow">OPERATOR VIEW</p>
          <h1 id="imports-title">Imports</h1>
          <p>Stage lead data, inspect exclusions, then commit and approve in separate steps.</p>
        </div>
      </header>

      <form className="import-form" onSubmit={submitPreview}>
        <label>
          CSV file
          <input
            accept=".csv,text/csv"
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Default calling code
          <input
            inputMode="numeric"
            pattern="[1-9][0-9]{0,2}"
            required
            value={defaultCallingCode}
            onChange={(event) => setDefaultCallingCode(event.target.value)}
          />
        </label>
        <button className="primary-action" disabled={busy || !file} type="submit">
          {busy && !preview ? "Staging…" : "Stage preview"}
        </button>
      </form>

      {error ? <p className="status-message status-message--error">{error}</p> : null}

      {preview ? (
        <section className="import-preview" aria-label="Import preview">
          <div className="preview-heading">
            <div>
              <p className="eyebrow">{preview.filename}</p>
              <h2>{displayStatus(preview.status)}</h2>
            </div>
            <div className="import-actions">
              {preview.status === "staged" ? (
                <button disabled={busy} type="button" onClick={() => transition("commit")}>
                  Commit import
                </button>
              ) : null}
              {preview.status === "committed" ? (
                <button disabled={busy} type="button" onClick={() => transition("approve")}>
                  Approve import
                </button>
              ) : null}
            </div>
          </div>

          <div className="summary-grid">
            <strong>{preview.summary.valid} ready</strong>
            <strong>{preview.summary.blockedConsent} consent blocked</strong>
            <strong>{preview.summary.invalid} invalid</strong>
            <strong>{preview.summary.duplicate} duplicate</strong>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Classification</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.rowNumber}</td>
                    <td>{[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td>{row.normalizedPhone ?? row.originalPhone}</td>
                    <td>{row.classification.replaceAll("_", " ")}</td>
                    <td>{row.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="section-block" aria-labelledby="import-history-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h2 id="import-history-title">Recent imports</h2>
          </div>
        </div>
        {historyError ? (
          <div className="stream-warning">Import history could not be loaded.</div>
        ) : null}
        <div className="import-history-list">
          {history.map((batch) => (
            <article className="import-history-card" key={batch.id}>
              <div>
                <strong>{batch.filename}</strong>
                <span>{new Date(batch.createdAt).toLocaleString()}</span>
              </div>
              <div className="tag-row">
                <span>{batch.summary.valid} ready to call</span>
                {batch.summary.blockedConsent ? (
                  <span>{batch.summary.blockedConsent} consent blocked</span>
                ) : null}
                {batch.summary.invalid ? <span>{batch.summary.invalid} invalid</span> : null}
              </div>
              <span className={`health-badge health-${batch.status}`}>
                {displayStatus(batch.status)}
              </span>
            </article>
          ))}
          {!history.length && !historyError ? <p>No previous imports.</p> : null}
        </div>
      </section>
    </section>
  );
}
