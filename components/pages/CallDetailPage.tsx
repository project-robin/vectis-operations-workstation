"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
  CallStatusBadge,
  CrmStatusBadge,
  errorText,
  formatDuration,
  formatWhen,
  PageHeader,
} from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { displayValue } from "@/convex/lib/crmNote";

type TranscriptLine = { speaker: "assistant" | "user" | "other"; text: string };

function parseTranscript(raw?: string): TranscriptLine[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]*\]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(assistant|user|bot|agent|human)\s*:\s*(.*)$/i);
      if (!match) return { speaker: "other" as const, text: line };
      const who = match[1].toLowerCase();
      return {
        speaker: who === "user" || who === "human" ? ("user" as const) : ("assistant" as const),
        text: match[2],
      };
    });
}

function extractedEntries(extracted?: string): [string, string][] {
  if (!extracted) return [];
  try {
    return Object.entries(JSON.parse(extracted) as Record<string, unknown>)
      .filter(
        ([key, value]) =>
          !["call_summary", "answers"].includes(key) &&
          value !== "" &&
          value !== null &&
          value !== undefined,
      )
      .map(([key, value]) => [key.replace(/_/g, " "), displayValue(value)]);
  } catch {
    return [];
  }
}

export function CallDetailPage({ callId }: { callId: string }) {
  const data = useQuery(api.calls.get, { callId });
  const retryCrm = useMutation(api.calls.retryCrmSync);
  const refreshNow = useMutation(api.calls.refreshNow);
  const [error, setError] = useState<string | null>(null);

  if (data === undefined) return <div className="empty-state">Loading…</div>;
  if (data === null) return <div className="empty-state">Call not found.</div>;
  const { call, lead, batch } = data;
  const transcript = parseTranscript(call.transcript);
  const live = call.status === "queued" || call.status === "in_progress";

  return (
    <>
      <PageHeader
        title={call.contactName ?? call.phone}
        subtitle={`${call.kind === "quick" ? "Quick call" : "Lead call"} · ${call.phone} · ${formatWhen(call.createdAt)}`}
        actions={
          <>
            {live ? (
              <button
                className="btn"
                type="button"
                onClick={() =>
                  void refreshNow({ callId: call._id }).catch((e) => setError(errorText(e)))
                }
              >
                Check now
              </button>
            ) : null}
            <a className="btn" href={`/quick-call`}>
              New quick call
            </a>
          </>
        }
      />
      {error ? <div className="notice notice-error">{error}</div> : null}

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Status</span>
          <CallStatusBadge status={call.status} />
        </div>
        <div className="stat-card">
          <span className="stat-label">Length</span>
          <strong className="stat-value">{formatDuration(call.durationSeconds)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Ended because</span>
          <strong className="stat-value small">
            {call.disposition?.replace(/_/g, " ") ?? "—"}
          </strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Twenty CRM</span>
          <CrmStatusBadge status={call.crmStatus} />
          {call.crmStatus === "failed" ||
          (call.crmStatus === "skipped" && !live && call.status !== "failed") ? (
            <button
              className="link-button"
              type="button"
              onClick={() =>
                void retryCrm({ callId: call._id }).catch((e) => setError(errorText(e)))
              }
            >
              Retry sync
            </button>
          ) : null}
        </div>
      </div>

      {live ? (
        <div className="notice notice-info">
          {call.status === "queued"
            ? "Placing the call…"
            : "The call is in progress. This page updates by itself when it ends."}
        </div>
      ) : null}
      {call.error ? <div className="notice notice-error">{call.error}</div> : null}
      {call.crmError ? <div className="notice notice-error">CRM: {call.crmError}</div> : null}
      {call.followUpRequired ? (
        <div className="notice notice-warning">
          The agent flagged this call for a human follow-up.
        </div>
      ) : null}

      <div className="two-col">
        <div>
          {call.brief ? (
            <section className="panel">
              <h2 className="section-title">What you asked for</h2>
              <p className="prewrap">{call.brief}</p>
            </section>
          ) : null}
          <section className="panel">
            <h2 className="section-title">Summary</h2>
            <p className="prewrap">
              {call.summary ??
                (live ? "Available when the call ends." : "No summary for this call.")}
            </p>
          </section>
          {call.answers ? (
            <section className="panel">
              <h2 className="section-title">Answers</h2>
              <ul className="qa-list">
                {call.answers
                  .split(/\r?\n/)
                  .filter((line: string) => line.trim())
                  .map((line: string) => {
                    const [question, answer] = line.split(/\s+[—-]\s+A:\s*/);
                    return (
                      <li key={line}>
                        <span className="qa-q">{question.replace(/^Q:\s*/, "")}</span>
                        {answer !== undefined ? <span className="qa-a">{answer}</span> : null}
                      </li>
                    );
                  })}
              </ul>
            </section>
          ) : null}
          {extractedEntries(call.extracted).length > 0 ? (
            <section className="panel">
              <h2 className="section-title">Captured details</h2>
              <dl className="details">
                {extractedEntries(call.extracted).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>

        <div>
          {call.recordingUrl ? (
            <section className="panel">
              <h2 className="section-title">Recording</h2>
              {/* biome-ignore lint/a11y/useMediaCaption: call recordings have a transcript below */}
              <audio controls preload="none" src={call.recordingUrl} style={{ width: "100%" }} />
            </section>
          ) : null}
          <section className="panel">
            <h2 className="section-title">Transcript</h2>
            {transcript.length === 0 ? (
              <p className="muted">{live ? "Available when the call ends." : "No transcript."}</p>
            ) : (
              <ol className="transcript">
                {transcript.map((line, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: transcript lines are immutable and may repeat verbatim
                  <li key={index} className={`bubble bubble-${line.speaker}`}>
                    <span className="speaker">
                      {line.speaker === "user"
                        ? (call.contactName ?? "Contact")
                        : line.speaker === "assistant"
                          ? "Agent"
                          : ""}
                    </span>
                    {line.text}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="panel">
            <h2 className="section-title">Details</h2>
            <dl className="details">
              {lead ? (
                <div>
                  <dt>Lead</dt>
                  <dd>
                    {lead.name} · {lead.phone}
                  </dd>
                </div>
              ) : null}
              {batch ? (
                <div>
                  <dt>Campaign</dt>
                  <dd>{batch.name}</dd>
                </div>
              ) : null}
              <div>
                <dt>Dograh run</dt>
                <dd>{call.dograhRunName ?? call.dograhRunId ?? "—"}</dd>
              </div>
              {call.crmPersonId ? (
                <div>
                  <dt>Twenty person</dt>
                  <dd className="mono">{call.crmPersonId}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}
