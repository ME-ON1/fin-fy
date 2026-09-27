"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { CAT_LABELS } from "@/lib/constants";
import { fmtDay, fmtMoney } from "@/lib/format";
import type { LedgerResponse, LedgerRow, TxStatus } from "@/lib/types";
import TxRow from "../TxRow";

function dayTotal(rows: LedgerRow[], day: string) {
  let out = 0;
  let inc = 0;
  for (const r of rows) {
    if (r.date !== day || r.status !== "success") continue;
    if (r.type === "debit") out += r.amount;
    else inc += r.amount;
  }
  const parts: React.ReactNode[] = [];
  if (out)
    parts.push(
      <span key="o" style={{ color: "var(--red)" }}>
        {fmtMoney(out)}
      </span>,
    );
  if (inc)
    parts.push(
      <span key="i" style={{ color: "var(--green)" }}>
        {fmtMoney(inc)}
      </span>,
    );
  return parts;
}

function categoryLine(byCat: Record<string, number>) {
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "—";
  return entries
    .slice(0, 5)
    .map(([c, v]) => `${CAT_LABELS[c as keyof typeof CAT_LABELS] || ""} ${c}: ${fmtMoney(v)}`)
    .join(" · ");
}

export default function LedgerView() {
  const { api, month, filterMember, toast, version, setTab, bump } = useApp();
  const [data, setData] = useState<LedgerResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ month });
    if (filterMember) q.set("member_id", filterMember);
    api<LedgerResponse>(`/api/views/ledger?${q}`)
      .then((d) => {
        if (alive && d) setData(d);
      })
      .catch((e) => toast((e as Error).message, "err"));
    return () => {
      alive = false;
    };
  }, [api, month, filterMember, version, toast]);

  const mark = async (id: string, status: TxStatus) => {
    try {
      const res = await api(`/api/transactions/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (res === null) return;
      toast(status === "success" ? "Marked as paid ✓" : "Marked as failed", "ok");
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  if (!data || !data.summary) return null;
  const s = data.summary;

  // group rows by day, preserving API order (date asc)
  const groups: { day: string; rows: LedgerRow[] }[] = [];
  for (const t of data.rows) {
    const last = groups[groups.length - 1];
    if (!last || last.day !== t.date) groups.push({ day: t.date, rows: [t] });
    else last.rows.push(t);
  }

  return (
    <section className="view">
      <div className="summary-cards">
        <div className="sum-card">
          <div className="label">Spent</div>
          <div className="value neg">{fmtMoney(s.total_spent)}</div>
        </div>
        <div className="sum-card">
          <div className="label">Received</div>
          <div className="value pos">{fmtMoney(s.total_received)}</div>
        </div>
        <div className="sum-card">
          <div className="label">Shared spend</div>
          <div className="value amber">{fmtMoney(s.shared_spent)}</div>
        </div>
        <div className="sum-card">
          <div className="label">Net</div>
          <div className={`value ${s.net >= 0 ? "pos" : "neg"}`}>
            {fmtMoney(s.net)}
          </div>
        </div>
        <div className="sum-card wide">
          <div className="label">By category</div>
          <div className="value">{categoryLine(s.by_category)}</div>
        </div>
        {s.pending_count ? (
          <div className="sum-card wide">
            <div className="label">
              ⏳ {s.pending_count} payment(s) unconfirmed — excluded from totals
              until marked
            </div>
            <div className="value"></div>
          </div>
        ) : null}
        <div
          className="sum-card wide"
          style={{ padding: 8, textAlign: "center" }}
        >
          <button className="btn-inline" onClick={() => setTab("split")}>
            🧮 View split-wise ▶
          </button>
        </div>
      </div>

      {!data.rows.length ? (
        <div className="empty">
          No transactions for this month.
          <br />
          Upload a statement PDF above ☝️
        </div>
      ) : (
        groups.map((g) => (
          <div className="day-group" key={g.day}>
            <div className="day-head">
              <span>{fmtDay(g.day)}</span>
              <span>{dayTotal(data.rows, g.day)}</span>
            </div>
            {g.rows.map((t) => (
              <TxRow key={t.id} t={t} confirmable onStatus={mark} />
            ))}
          </div>
        ))
      )}
    </section>
  );
}
