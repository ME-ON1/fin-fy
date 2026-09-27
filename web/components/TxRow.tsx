"use client";

import { CAT_LABELS } from "@/lib/constants";
import { fmtMoney } from "@/lib/format";
import type { LedgerRow, TxStatus } from "@/lib/types";

export default function TxRow({
  t,
  onStatus,
  confirmable = false,
}: {
  t: LedgerRow;
  onStatus?: (id: string, status: TxStatus) => void;
  confirmable?: boolean;
}) {
  const pending = t.status === "pending";
  const subParts: string[] = [];
  if (t.remarks) subParts.push(`“${t.remarks}”`);
  if (t.counterparty_upi) subParts.push(t.counterparty_upi);
  if (t.account_name) subParts.push(t.account_name);

  return (
    <div className={`tx${pending ? " tx-pending" : ""}`} data-id={t.id}>
      <div className="tx-main">
        <div className="tx-desc">{t.description}</div>
        <div className="tx-sub">{subParts.join(" · ")}</div>
        <div className="tx-badges">
          <span className="badge cat">
            {CAT_LABELS[t.category] || ""} {t.category}
          </span>
          <span className="badge member">{t.member_name}</span>
          {t.is_shared ? (
            <span className="badge shared">
              🤝 both{t.shared_with_name ? ` ↔ ${t.shared_with_name}` : ""}
            </span>
          ) : null}
          {pending ? <span className="badge pending">⏳ pending</span> : null}
        </div>
        {pending && confirmable && onStatus ? (
          <div className="tx-confirm">
            Was it paid?{" "}
            <button
              className="badge-btn ok"
              onClick={() => onStatus(t.id, "success")}
            >
              ✓ yes
            </button>
            <button
              className="badge-btn bad"
              onClick={() => onStatus(t.id, "failed")}
            >
              ✗ no
            </button>
          </div>
        ) : null}
      </div>
      <div className={`tx-amt ${t.type}`}>
        {t.type === "debit" ? "−" : "+"}
        {fmtMoney(t.amount)}
      </div>
    </div>
  );
}
