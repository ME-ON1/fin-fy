"use client";

import { useEffect, useRef, useState } from "react";
import {
  clearPayState,
  loadPayState,
  savePayState,
  useApp,
} from "@/lib/store";
import { NOTE_PRESETS } from "@/lib/constants";
import { fmtMoney } from "@/lib/format";
import {
  buildTezUrl,
  decodeQrFile,
  guessPayCategory,
  normalizePayee,
  parseUpiQr,
  type PayState,
  type UpiQuery,
} from "@/lib/upi";
import type { BatchResult, TxStatus } from "@/lib/types";

type Phase = "idle" | "form" | "waiting" | "result";

const EMPTY_PAY: PayState = { pa: null, pn: null, am: "", cu: "INR", note: "" };

export default function PayView() {
  const { me, members, api, toast, openRegister, bump } = useApp();
  const [phase, setPhase] = useState<Phase>("idle");
  const [pay, setPay] = useState<PayState | null>(null);
  const [manual, setManual] = useState(false);
  const [manualUpi, setManualUpi] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const qrInputRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);

  // resume an in-flight payment (e.g. page reloaded while paying)
  useEffect(() => {
    if (!me) {
      openRegister();
      return;
    }
    const st = loadPayState() as PayState | null;
    if (st) {
      setPay(st);
      setPhase("result");
    }
  }, [me, openRegister]);

  // when returning from Google Pay, surface the result screen
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) return;
      const st = loadPayState() as PayState | null;
      if (st) {
        setPay(st);
        setPhase("result");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const applyPay = (q: UpiQuery) => {
    const ps: PayState = {
      pa: q.pa,
      pn: q.pn,
      am: q.am || "",
      cu: q.cu || "INR",
      note: q.tn || "",
    };
    setPay(ps);
    setManual(false);
    setManualUpi("");
    setAmount(q.am || "");
    setNote(q.tn || "");
    setPhase("form");
    setTimeout(() => amountRef.current?.focus(), 50);
  };

  const onQrFile = async (file?: File) => {
    if (!file) return;
    toast("Reading QR…");
    let text: string;
    try {
      text = await decodeQrFile(file);
    } catch (e) {
      toast((e as Error).message, "err");
      return;
    }
    const q = parseUpiQr(text);
    if (!q || !q.pa) {
      toast("That QR isn't a UPI payment code", "err");
      return;
    }
    applyPay(q);
  };

  const openManualEntry = () => {
    if (!me) {
      openRegister();
      return;
    }
    setPay({ ...EMPTY_PAY });
    setManual(true);
    setManualUpi("");
    setAmount("");
    setNote("");
    setPhase("form");
    setTimeout(() => manualRef.current?.focus(), 50);
  };

  const startPay = () => {
    if (!me) {
      openRegister();
      return;
    }
    const am = parseFloat(amount);
    if (!am || am <= 0) {
      toast("Enter an amount", "err");
      return;
    }
    if (!Number.isInteger(am)) {
      toast("Whole rupees only (no paise)", "err");
      return;
    }
    let pa = pay?.pa ?? null;
    let pn = pay?.pn ?? null;
    if (!pa) {
      pa = normalizePayee(manualUpi);
      if (!pa) {
        toast("Enter a valid UPI id (name@bank) or phone number", "err");
        return;
      }
      pn = null;
    }
    const ps: PayState = {
      pa,
      pn,
      am: String(am),
      cu: "INR",
      note: note.trim(),
    };
    setPay(ps);
    savePayState(ps);
    setPhase("waiting");
    window.location.href = buildTezUrl(ps);
  };

  const resetPay = () => {
    clearPayState();
    setPay(null);
    setPhase("idle");
    setAmount("");
    setNote("");
  };

  const savePaidTransaction = async (status: TxStatus) => {
    if (!pay || !me) return;
    const n = pay.note || "";
    const category = guessPayCategory(n);
    const isShared = /\bboth\b/i.test(n) || category === "groceries";
    let sharedWithId: string | null = null;
    if (isShared) {
      const others = members.filter((m) => m.id !== me.id);
      if (others.length === 1) sharedWithId = others[0].id;
    }
    const payload = {
      transactions: [
        {
          date: new Date().toISOString().slice(0, 10),
          description: `UPI payment to ${pay.pn || pay.pa}`,
          remarks: n || null,
          category,
          counterparty: pay.pn || null,
          counterparty_upi: pay.pa,
          amount: parseFloat(pay.am),
          type: "debit",
          is_shared: isShared,
          shared_with_id: sharedWithId,
          status,
        },
      ],
      source_file: null,
    };
    try {
      const res = await api<BatchResult>("/api/transactions/batch", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res === null) return;
      if (status === "pending") {
        toast("Saved as pending — not counted until confirmed ⏳", "ok");
      } else {
        toast(`Saved ✓ ${fmtMoney(pay.am)}${isShared ? " · shared" : ""}`, "ok");
      }
      resetPay();
      bump();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, "err");
    }
  };

  return (
    <section className="view">
      <input
        ref={qrInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          onQrFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {phase === "idle" ? (
        <div className="pay-card">
          <button
            className="scan-btn"
            onClick={() => {
              if (!me) {
                openRegister();
                return;
              }
              qrInputRef.current?.click();
            }}
          >
            <span className="scan-icon">📷</span>
            <span className="scan-main">Scan UPI QR code</span>
            <span className="scan-sub">
              opens your camera · works on this HTTP network
            </span>
          </button>
          <button className="btn-ghost" onClick={openManualEntry}>
            📱 Pay to a phone number
          </button>
          <button className="btn-ghost" onClick={openManualEntry}>
            Or enter UPI id manually
          </button>
        </div>
      ) : null}

      {phase === "form" ? (
        <div className="pay-card">
          <div className="pay-merchant">
            <div className="pm-avatar">🏪</div>
            <div className="pm-info">
              <div className="pm-name">
                {manual ? "Manual entry" : pay?.pn || "Merchant"}
              </div>
              <div className="pm-upi">
                {manual
                  ? "UPI id (name@bank) or phone number"
                  : pay?.pa || "—"}
              </div>
            </div>
          </div>

          {manual ? (
            <input
              ref={manualRef}
              type="text"
              placeholder="merchant@upi or +91 phone number"
              value={manualUpi}
              onChange={(e) => setManualUpi(e.target.value)}
              className="note-custom"
              style={{ marginTop: 0 }}
            />
          ) : null}

          <label>Amount (₹)</label>
          <input
            ref={amountRef}
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            placeholder="0"
            className="amount-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          <label>Transaction note</label>
          <div className="note-chips">
            {NOTE_PRESETS.map((p) => (
              <button
                key={p.note}
                className={`note-chip${p.both ? " both" : ""}${
                  p.note === note ? " active" : ""
                }`}
                onClick={() => setNote(p.note)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="custom note…"
            className="note-custom"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <button className="btn-primary pay-now" onClick={startPay}>
            Pay with Google Pay ▶
          </button>
        </div>
      ) : null}

      {phase === "waiting" ? (
        <div className="pay-card">
          <div className="result-icon">⏳</div>
          <div className="result-title">Payment sent to Google Pay</div>
          <div className="result-sub">
            Finish the payment there — when you&apos;re back, tell us how it went.
          </div>
          <button
            className="btn-ghost"
            onClick={() => {
              const st = loadPayState() as PayState | null;
              if (st) {
                setPay(st);
                setPhase("result");
              }
            }}
          >
            I&apos;m back
          </button>
        </div>
      ) : null}

      {phase === "result" ? (
        <div className="pay-card">
          <div className="result-icon">🤔</div>
          <div className="result-title">How did it go?</div>
          <div className="result-sub">
            {pay
              ? `${fmtMoney(pay.am)} to ${pay.pn || pay.pa}` +
                (pay.note ? ` · “${pay.note}”` : "")
              : ""}
          </div>
          <div className="result-actions result-three">
            <button
              className="btn-ghost"
              onClick={() => {
                toast("Not saved — payment failed", "err");
                resetPay();
              }}
            >
              ✗ Failed
            </button>
            <button
              className="btn-ghost"
              onClick={() => savePaidTransaction("pending")}
            >
              ? No status
            </button>
            <button
              className="btn-primary"
              onClick={() => savePaidTransaction("success")}
            >
              ✓ Success
            </button>
          </div>
          <p
            className="muted"
            style={{ textAlign: "center", marginTop: 10 }}
          >
            Only <b>Success</b> counts in the totals. “No status” is kept out
            until you confirm it.
          </p>
        </div>
      ) : null}
    </section>
  );
}
