"use client";

import { useApp } from "@/lib/store";

export default function Toolbar() {
  const { month, setMonth, filterMember, setFilterMember, members } = useApp();
  return (
    <section className="toolbar">
      <input
        type="month"
        className="month-input"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
      <select
        className="member-filter"
        value={filterMember}
        onChange={(e) => setFilterMember(e.target.value)}
      >
        <option value="">Everyone</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </section>
  );
}
