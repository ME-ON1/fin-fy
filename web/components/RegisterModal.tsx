"use client";

import { useState } from "react";
import { useApp } from "@/lib/store";

export default function RegisterModal() {
  const { registerState, saveRegistration } = useApp();
  const [name, setName] = useState("");
  const [upi, setUpi] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!registerState.open) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter your name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveRegistration(trimmed, upi, pin);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal">
      <div className="modal-card">
        <h2>Who is this device?</h2>
        <p className="muted">
          This device is fingerprinted and bound to your name. Uploads and
          transactions are only accessible from it.
        </p>
        {registerState.note ? (
          <p className="error" style={{ marginTop: 10 }}>
            {registerState.note}
          </p>
        ) : null}

        <label>Name</label>
        <input
          type="text"
          placeholder="e.g. Rohan"
          autoComplete="name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />

        <label>Your UPI ID (optional)</label>
        <input
          type="text"
          placeholder="e.g. rohan@okaxis"
          autoComplete="off"
          value={upi}
          onChange={(e) => setUpi(e.target.value)}
        />

        <label>PIN (4+ digits) — needed to add another device later</label>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          placeholder="····"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />

        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>

        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
