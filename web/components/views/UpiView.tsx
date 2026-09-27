"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { fmtMoney } from "@/lib/format";
import type { UpiSummaryResponse } from "@/lib/types";
import TxRow from "../TxRow";

export default function UpiView() {
  const { api, month, filterMember, toast, version } = useApp();
  const [data, setData] = useState<UpiSummaryResponse | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ month });
    if (filterMember) q.set("member_id", filterMember);
    api<UpiSummaryResponse>(`/api/views/upi-summary?${q}`)
      .then((d) => {
        if (alive && d) setData(d);
      })
      .catch((e) => toast((e as Error).message, "err"));
    return () => {
      alive = false;
    };
  }, [api, month, filterMember, version, toast]);

  if (!data) return null;

  if (!data.buckets.length) {
    return (
      <section className="view">
        <div className="empty">No payments this month.</div>
      </section>
    );
  }

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section className="view">
      <div className="upi-card" style={{ pointerEvents: "none" }}>
        <div className="upi-head">
          <div className="upi-id">
            <div className="vpa" style={{ color: "var(--muted)", fontSize: 12 }}>
              TOTAL PAID
            </div>
          </div>
          <div className="upi-total" style={{ color: "var(--text)" }}>
            {fmtMoney(data.total_spent)}
          </div>
        </div>
      </div>

      {data.buckets.map((b, i) => {
        const name = b.counterparty_upi || b.counterparty || "other";
        return (
          <div
            className={`upi-card${open.has(i) ? " open" : ""}`}
            key={i}
          >
            <div className="upi-head" onClick={() => toggle(i)}>
              <div className="upi-id">
                <div className="vpa">{name}</div>
                <div className="meta">
                  {b.count} payment{b.count > 1 ? "s" : ""}
                  {b.shared_total
                    ? ` · 🤝 ${fmtMoney(b.shared_total)} shared`
                    : ""}
                </div>
              </div>
              <div className="upi-total">
                {fmtMoney(b.total)}
                <span className="sub">{b.shared_total ? "incl. shared" : ""}</span>
              </div>
            </div>
            <div className="upi-body">
              {b.transactions.map((t) => (
                <TxRow key={t.id} t={t} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
