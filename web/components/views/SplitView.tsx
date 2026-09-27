"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { fmtDay, fmtMoney } from "@/lib/format";
import type { SplitResponse, SplitTx } from "@/lib/types";

export default function SplitView() {
  const { api, month, filterMember, toast, version } = useApp();
  const [data, setData] = useState<SplitResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ month });
    if (filterMember) q.set("member_id", filterMember);
    api<SplitResponse>(`/api/views/split?${q}`)
      .then((d) => {
        if (alive && d) setData(d);
      })
      .catch((e) => toast((e as Error).message, "err"));
    return () => {
      alive = false;
    };
  }, [api, month, filterMember, version, toast]);

  if (!data || !data.transactions) return null;

  const groups: { day: string; rows: SplitTx[] }[] = [];
  for (const t of data.transactions) {
    const last = groups[groups.length - 1];
    if (!last || last.day !== t.date) groups.push({ day: t.date, rows: [t] });
    else last.rows.push(t);
  }

  return (
    <section className="view">
      <div className="summary-cards">
        <div className="sum-card">
          <div className="label">Shared txns</div>
          <div className="value amber">{data.shared_count}</div>
        </div>
        <div className="sum-card">
          <div className="label">Shared total</div>
          <div className="value amber">{fmtMoney(data.shared_total)}</div>
        </div>
        {data.unsettled_count ? (
          <div className="sum-card wide">
            <div className="label">
              ⚠️ {data.unsettled_count} shared txn(s) have no partner selected —
              the split shows only when a partner is set
            </div>
            <div className="value"></div>
          </div>
        ) : null}
      </div>

      <div className="settlements">
        {data.settlements.length ? (
          data.settlements.map((s, i) => (
            <div className="settle-card" key={i}>
              <div className="settle-arrow">🔁</div>
              <div className="settle-names">
                <span className="who">pays</span>
                {s.owes} → {s.to}
              </div>
              <div className="settle-amt">{fmtMoney(s.amount)}</div>
            </div>
          ))
        ) : (
          <div className="empty">No settlements this month.</div>
        )}
      </div>

      {!data.transactions.length ? (
        <div className="empty">No shared (&quot;both&quot;) transactions this month.</div>
      ) : (
        groups.map((g) => (
          <div className="day-group" key={g.day}>
            <div className="day-head">
              <span>{fmtDay(g.day)}</span>
            </div>
            {g.rows.map((t) => (
              <div className="tx split-row" key={t.id}>
                <div className="tx-main">
                  <div className="tx-desc">🤝 {t.description}</div>
                  <div className="tx-sub">
                    {t.other
                      ? `${t.payer} ↔ ${t.other} · each pays ${fmtMoney(t.each_pays ?? 0)}`
                      : `${t.payer} · no partner set`}
                  </div>
                </div>
                <div className="tx-amt">
                  {fmtMoney(t.amount)}
                  <span className="split-half">
                    <br />
                    {t.other ? `→ ${fmtMoney(t.each_pays ?? 0)} each` : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}
