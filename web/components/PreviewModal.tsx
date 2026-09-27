"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { CATEGORIES, CAT_LABELS } from "@/lib/constants";
import { fmtMoney } from "@/lib/format";
import type { Category, EditableParsedTx } from "@/lib/types";

export default function PreviewModal() {
  const { preview, setPreview, savePreview, members, me } = useApp();
  const [rows, setRows] = useState<EditableParsedTx[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (preview) setRows(preview.transactions);
  }, [preview]);

  if (!preview) return null;

  const others = members.filter((m) => m.id !== me?.id);

  const update = (i: number, patch: Partial<EditableParsedTx>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const remove = (i: number) =>
    setRows((rs) => rs.filter((_, idx) => idx !== i));

  const save = async (goSplit: boolean) => {
    setBusy(true);
    try {
      await savePreview({ ...preview, transactions: rows }, goSplit);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal">
      <div className="modal-card preview-card">
        <h2>Review parsed transactions</h2>
        <div className="preview-scroll">
          <div className="preview-meta">
            {preview.account?.name ? (
              <span>
                Account: <b>{preview.account.name}</b>
              </span>
            ) : null}
            {preview.account?.upi_id ? (
              <span>
                UPI: <b>{preview.account.upi_id}</b>
              </span>
            ) : null}
            <span>
              File: <b>{preview.source_file}</b>
            </span>
          </div>

          {preview.warnings.length ? (
            <div className="warnings">
              {preview.warnings.map((w, i) => (
                <div key={i}>⚠️ {w}</div>
              ))}
            </div>
          ) : null}

          <div className="preview-rows">
            {rows.map((t, i) => {
              const selectedId =
                t.shared_with_id ??
                others.find((m) => m.name === t.shared_hint)?.id ??
                "";
              return (
                <div className="prow" key={i}>
                  <div className="prow-top">
                    <div className="prow-date">{t.date}</div>
                    <div className="prow-desc">
                      {t.description}
                      {t.remarks ? (
                        <>
                          <br />
                          <span className="muted">“{t.remarks}”</span>
                        </>
                      ) : null}
                    </div>
                    <div className={`prow-amt ${t.type}`}>
                      {t.type === "debit" ? "−" : "+"}
                      {fmtMoney(t.amount)}
                    </div>
                  </div>
                  <div className="prow-fields">
                    <input
                      type="text"
                      className="prow-remarks"
                      placeholder="remarks…"
                      value={t.remarks || ""}
                      onChange={(e) =>
                        update(i, { remarks: e.target.value || null })
                      }
                    />
                    <select
                      className="prow-cat"
                      value={t.category}
                      onChange={(e) =>
                        update(i, { category: e.target.value as Category })
                      }
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CAT_LABELS[c]} {c}
                        </option>
                      ))}
                    </select>
                    <label className="prow-toggle">
                      <input
                        type="checkbox"
                        checked={t.is_shared}
                        onChange={(e) =>
                          update(i, { is_shared: e.target.checked })
                        }
                      />
                      both
                    </label>
                    <select
                      className="prow-shared"
                      hidden={!t.is_shared}
                      disabled={!t.is_shared}
                      value={selectedId}
                      onChange={(e) =>
                        update(i, { shared_with_id: e.target.value || null })
                      }
                    >
                      <option value="">with…</option>
                      {others.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="prow-del"
                      title="Remove row"
                      onClick={() => remove(i)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="preview-actions">
          <button className="btn-ghost" onClick={() => setPreview(null)}>
            Discard
          </button>
          <button
            className="btn-primary btn-split"
            disabled={busy}
            onClick={() => save(true)}
          >
            Save &amp; view split ▶
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => save(false)}
          >
            Save all ({rows.length})
          </button>
        </div>
      </div>
    </div>
  );
}
