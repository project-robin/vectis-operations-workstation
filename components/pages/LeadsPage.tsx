"use client";

import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { errorText, formatWhen, LeadStatusBadge, PageHeader, StatCard } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { guessColumns, type LeadField, parseCsv } from "@/lib/csv";

type Filter = "all" | "new" | "queued" | "called" | "failed";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["new", "Not called"],
  ["failed", "Needs retry"],
  ["queued", "In a campaign"],
  ["called", "Called"],
];
const CHUNK = 400;

type Preview = {
  fileName: string;
  headers: string[];
  rows: string[][];
  mapping: Record<LeadField, number>;
};

export function LeadsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const stats = useQuery(api.leads.stats, {});
  const { results, status, loadMore } = usePaginatedQuery(
    api.leads.list,
    filter === "all" ? {} : { status: filter },
    { initialNumItems: 50 },
  );
  const importRows = useMutation(api.leads.importRows);
  const removeLead = useMutation(api.leads.remove);
  const callLeads = useMutation(api.calls.callLeads);
  const importFromTwenty = useAction(api.leads.importFromTwenty);

  const [selected, setSelected] = useState<Set<Id<"leads">>>(new Set());
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [preview, setPreview] = useState<Preview | null>(null);

  const run = async (label: string, work: () => Promise<string>) => {
    setBusy(label);
    setNotice(null);
    try {
      setNotice({ tone: "success", text: await work() });
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const addLead = (event: React.FormEvent) => {
    event.preventDefault();
    void run("add", async () => {
      const result = await importRows({
        source: "manual",
        rows: [{ ...form, email: form.email || undefined, notes: form.notes || undefined }],
      });
      if (result.invalid.length) throw new Error(result.invalid[0].reason);
      setForm({ name: "", phone: "", email: "", notes: "" });
      setShowAdd(false);
      return result.created
        ? `Added ${form.name || form.phone}.`
        : "That number was already in your leads; details updated.";
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      setNotice({ tone: "error", text: "That file has no data rows." });
      return;
    }
    const [headers, ...body] = rows;
    setPreview({ fileName: file.name, headers, rows: body, mapping: guessColumns(headers) });
  };

  const confirmImport = () => {
    if (!preview) return;
    const { mapping } = preview;
    if (mapping.phone < 0) {
      setNotice({ tone: "error", text: "Pick which column has the phone number." });
      return;
    }
    const cell = (row: string[], index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");
    const leads = preview.rows
      .map((row) => ({
        name: cell(row, mapping.name) || "Unknown",
        phone: cell(row, mapping.phone),
        email: cell(row, mapping.email) || undefined,
        notes: cell(row, mapping.notes) || undefined,
      }))
      .filter((lead) => lead.phone);
    void run("import", async () => {
      let created = 0;
      let updated = 0;
      let invalid = 0;
      for (let i = 0; i < leads.length; i += CHUNK) {
        const result = await importRows({ source: "csv", rows: leads.slice(i, i + CHUNK) });
        created += result.created;
        updated += result.updated;
        invalid += result.invalid.length;
      }
      setPreview(null);
      return `Imported ${created} new lead${created === 1 ? "" : "s"}${updated ? `, updated ${updated}` : ""}${invalid ? `, skipped ${invalid} with bad or duplicate numbers` : ""}.`;
    });
  };

  const callSelected = (all: boolean) =>
    run("call", async () => {
      const name = `Lead calls · ${new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
      const result = await callLeads(all ? { name } : { name, leadIds: [...selected] });
      setSelected(new Set());
      return `Sent ${result.count} lead${result.count === 1 ? "" : "s"} to the AI agent. Calls start within a minute — follow progress on the Campaigns page.`;
    });

  const toggle = (id: Id<"leads">) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const callable = results.filter((lead) => lead.status === "new" || lead.status === "failed");

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Everyone your AI agent should call. Import a CSV, pull from Twenty CRM, or add people one by one."
        actions={
          <>
            <button className="btn" type="button" onClick={() => setShowAdd((open) => !open)}>
              Add lead
            </button>
            <label className="btn">
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) =>
                  void onFile(e.target.files?.[0]).finally(() => (e.target.value = ""))
                }
              />
            </label>
            <button
              className="btn"
              type="button"
              disabled={busy !== null}
              onClick={() =>
                run("twenty", async () => {
                  const r = await importFromTwenty({});
                  return `From Twenty: ${r.created} new, ${r.updated} already here${r.skippedWithoutPhone ? `, ${r.skippedWithoutPhone} without a phone number skipped` : ""}.`;
                })
              }
            >
              {busy === "twenty" ? "Importing…" : "Import from Twenty"}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy !== null || !stats?.remaining}
              onClick={() => void callSelected(true)}
            >
              {busy === "call" && selected.size === 0
                ? "Starting…"
                : `Call all remaining (${stats?.remaining ?? 0})`}
            </button>
          </>
        }
      />

      {stats ? (
        <div className="stat-grid">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Not called" value={stats.new} />
          <StatCard label="Called" value={stats.called} tone="success" />
          <StatCard label="Needs retry" value={stats.failed} tone="warning" />
          <StatCard label="In a campaign" value={stats.queued} tone="info" />
        </div>
      ) : null}

      {notice ? (
        <div className={`notice ${notice.tone === "error" ? "notice-error" : "notice-success"}`}>
          {notice.text}
        </div>
      ) : null}

      {showAdd ? (
        <form className="panel form form-inline" onSubmit={addLead}>
          <label className="field">
            <span>Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Full name"
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+91 98765 43210"
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="optional"
              type="email"
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="optional"
            />
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy !== null}>
              Save lead
            </button>
          </div>
        </form>
      ) : null}

      {preview ? (
        <div className="panel">
          <h2 className="section-title">
            Import {preview.fileName} · {preview.rows.length} rows
          </h2>
          <p className="muted">
            Check which column holds each detail. Numbers without a country code are treated as
            Indian (+91).
          </p>
          <div className="form form-inline">
            {(["name", "phone", "email", "notes"] as LeadField[]).map((field) => (
              <label className="field" key={field}>
                <span>
                  {field === "phone" ? "Phone (required)" : field[0].toUpperCase() + field.slice(1)}
                </span>
                <select
                  value={preview.mapping[field]}
                  onChange={(e) =>
                    setPreview({
                      ...preview,
                      mapping: { ...preview.mapping, [field]: Number(e.target.value) },
                    })
                  }
                >
                  <option value={-1}>— none —</option>
                  {preview.headers.map((header, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: CSV headers can repeat; position is the identity
                    <option key={`${header}-${index}`} value={index}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 5).map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static preview of the first rows of a file
                <tr key={index}>
                  {(["name", "phone", "email", "notes"] as LeadField[]).map((field) => (
                    <td key={field}>
                      <div className="clamp">
                        {preview.mapping[field] >= 0 ? row[preview.mapping[field]] : ""}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions">
            <button className="btn" type="button" onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy !== null}
              onClick={confirmImport}
            >
              {busy === "import" ? "Importing…" : `Import ${preview.rows.length} rows`}
            </button>
          </div>
        </div>
      ) : null}

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? "tab active" : "tab"}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {selected.size > 0 ? (
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy !== null}
            onClick={() => void callSelected(false)}
          >
            {busy === "call" ? "Starting…" : `Call ${selected.size} selected`}
          </button>
        ) : null}
      </div>

      {results.length === 0 && status !== "LoadingFirstPage" ? (
        <div className="empty-state">
          {filter === "all"
            ? "No leads yet. Import a CSV or pull them from Twenty CRM."
            : "Nothing here."}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="check">
                <input
                  type="checkbox"
                  aria-label="Select all callable leads on this page"
                  checked={callable.length > 0 && callable.every((lead) => selected.has(lead._id))}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? new Set(callable.map((lead) => lead._id)) : new Set(),
                    )
                  }
                />
              </th>
              <th>Name</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Last result</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {results.map((lead) => (
              <tr key={lead._id}>
                <td className="check">
                  <input
                    type="checkbox"
                    aria-label={`Select ${lead.name}`}
                    disabled={lead.status === "queued" || lead.status === "called"}
                    checked={selected.has(lead._id)}
                    onChange={() => toggle(lead._id)}
                  />
                </td>
                <td>
                  <strong>{lead.name}</strong>
                  {lead.email ? <div className="muted">{lead.email}</div> : null}
                </td>
                <td className="nowrap">{lead.phone}</td>
                <td>
                  <LeadStatusBadge status={lead.status} />
                </td>
                <td>
                  {lead.lastCallId ? (
                    <a href={`/calls/${lead.lastCallId}`}>
                      {lead.lastOutcome?.replace(/_/g, " ") ?? "View call"} ·{" "}
                      {formatWhen(lead.lastCalledAt)}
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="muted">
                  {lead.source === "twenty"
                    ? "Twenty CRM"
                    : lead.source === "csv"
                      ? "CSV"
                      : "Manual"}
                </td>
                <td className="actions">
                  <button
                    type="button"
                    className="link-button danger"
                    disabled={lead.status === "queued"}
                    onClick={() => {
                      if (window.confirm(`Remove ${lead.name} from your leads?`))
                        void run(
                          "remove",
                          async () => (await removeLead({ leadId: lead._id }), "Lead removed."),
                        );
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {status === "CanLoadMore" ? (
        <div className="form-actions">
          <button className="btn" type="button" onClick={() => loadMore(100)}>
            Load more
          </button>
        </div>
      ) : null}
    </>
  );
}
