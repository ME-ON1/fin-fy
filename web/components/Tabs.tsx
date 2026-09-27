"use client";

import { useApp, type TabId } from "@/lib/store";

const TABS: { id: TabId; label: string }[] = [
  { id: "ledger", label: "Ledger" },
  { id: "upi", label: "By UPI" },
  { id: "split", label: "Split" },
  { id: "pay", label: "Pay" },
  { id: "people", label: "People" },
];

export default function Tabs() {
  const { tab, setTab } = useApp();
  return (
    <nav className="tabs">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tab${tab === t.id ? " active" : ""}`}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
