"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { fmtMoney } from "@/lib/format";
import type { MembersSummaryResponse } from "@/lib/types";

export default function PeopleView() {
  const { api, toast, version } = useApp();
  const [data, setData] = useState<MembersSummaryResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api<MembersSummaryResponse>("/api/views/members-summary")
      .then((d) => {
        if (alive && d) setData(d);
      })
      .catch((e) => toast((e as Error).message, "err"));
    return () => {
      alive = false;
    };
  }, [api, toast, version]);

  if (!data || !data.members) return null;

  if (!data.members.length) {
    return (
      <section className="view">
        <div className="empty">
          No members yet. Register your name from the top-right chip.
        </div>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="people-list">
        {data.members.map((m) => (
          <div className="person-card" key={m.id}>
            <div className="pname">{m.name}</div>
            <div className="psub">📱 {m.phone_model || "unknown device"}</div>
            <div className="person-stats">
              <div className="stat">
                <div className="v" style={{ color: "var(--red)" }}>
                  {fmtMoney(m.total_paid)}
                </div>
                <div className="l">paid</div>
              </div>
              <div className="stat">
                <div className="v" style={{ color: "var(--amber)" }}>
                  {fmtMoney(m.shared_paid)}
                </div>
                <div className="l">shared (their half owes back)</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
