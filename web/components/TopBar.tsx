"use client";

import { useApp } from "@/lib/store";

export default function TopBar() {
  const { me, toast, openRegister } = useApp();

  return (
    <header className="topbar">
      <div className="brand">💸 fin-fy</div>
      <button
        className="chip"
        title="Switch person / device"
        onClick={() => {
          if (me) {
            toast(
              `This device is registered to ${me.name} — one device = one person.`,
              "ok",
            );
            return;
          }
          openRegister();
        }}
      >
        <span>{me ? me.name : "Not registered"}</span>
        <span className="chip-sub">
          {me ? me.phone_model || "device" : "tap to set name"}
        </span>
      </button>
    </header>
  );
}
