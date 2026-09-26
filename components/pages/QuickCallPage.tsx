"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { CallStatusBadge, errorText, formatWhen, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

const EXAMPLES = [
  "Ask how they are feeling after starting the new tablets, whether they have any side effects like dizziness or nausea, and whether they are taking the medicine on time.",
  "Remind them about tomorrow's appointment at 11 AM and confirm whether they can make it. If not, ask what day and time suits them.",
  "Ask whether they received their order, if everything arrived in good condition, and how they would rate the service out of 5.",
];

export function QuickCallPage() {
  const startQuickCall = useMutation(api.calls.startQuickCall);
  const recent = useQuery(api.calls.list, { paginationOpts: { numItems: 6, cursor: null } });
  const [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const callId = await startQuickCall({ phone, contactName: contactName || undefined, brief });
      window.location.href = `/calls/${callId}`;
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  };

  const quickCalls = ((recent?.page ?? []) as Doc<"calls">[]).filter(
    (call) => call.kind === "quick",
  );

  return (
    <>
      <PageHeader
        title="Quick call"
        subtitle="Type a number and what you want to know. The AI agent calls right away, asks your questions, and reports back here and in your CRM."
      />
      <div className="two-col">
        <form className="panel form" onSubmit={submit}>
          <label className="field">
            <span>Phone number</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              inputMode="tel"
              required
              autoComplete="off"
            />
            <small>
              Include the country code. Numbers without one are treated as Indian (+91).
            </small>
          </label>
          <label className="field">
            <span>Name (optional)</span>
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="e.g. Ramesh Kumar"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>What should the agent ask?</span>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={7}
              maxLength={2000}
              placeholder="e.g. Ask how he is feeling after starting the new blood pressure tablets, whether he has dizziness or headaches, and his latest BP reading."
              required
            />
            <small>{brief.length}/2000 · Write it the way you'd brief a receptionist.</small>
          </label>
          {error ? <div className="notice notice-error">{error}</div> : null}
          <div className="form-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy || !phone.trim() || brief.trim().length < 5}
            >
              {busy ? "Starting call…" : "Call now"}
            </button>
          </div>
        </form>

        <aside className="panel">
          <h2 className="section-title">Example briefs</h2>
          <ul className="example-list">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button type="button" className="link-button" onClick={() => setBrief(example)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
          {quickCalls.length > 0 ? (
            <>
              <h2 className="section-title" style={{ marginTop: "var(--space-6, 24px)" }}>
                Recent quick calls
              </h2>
              <ul className="mini-list">
                {quickCalls.map((call) => (
                  <li key={call._id}>
                    <a href={`/calls/${call._id}`}>{call.contactName ?? call.phone}</a>
                    <CallStatusBadge status={call.status} />
                    <span className="muted">{formatWhen(call.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      </div>
    </>
  );
}
