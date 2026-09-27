"use client";

import { useRef } from "react";
import { useApp } from "@/lib/store";
import type { UploadPreview } from "@/lib/types";
import TopBar from "./TopBar";
import Tabs from "./Tabs";
import Toolbar from "./Toolbar";
import LedgerView from "./views/LedgerView";
import UpiView from "./views/UpiView";
import SplitView from "./views/SplitView";
import PeopleView from "./views/PeopleView";
import PayView from "./views/PayView";
import RegisterModal from "./RegisterModal";
import PreviewModal from "./PreviewModal";
import Toasts from "./Toasts";

export default function AppShell() {
  const { me, tab, toast, openRegister, api, setPreview } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => {
    if (!me) {
      toast("Register your name first", "err");
      openRegister();
      return;
    }
    fileRef.current?.click();
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      toast("Only PDF files supported", "err");
      return;
    }
    toast("Parsing statement…");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const p = await api<UploadPreview>("/api/upload", {
        method: "POST",
        body: fd,
      });
      if (p) setPreview(p);
    } catch (e) {
      toast(`Upload failed: ${(e as Error).message}`, "err");
    }
  };

  return (
    <div className="app">
      <TopBar />

      <main>
        <section className="upload-card">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button className="upload-btn" onClick={openFilePicker}>
            <span className="up-icon">⬆️</span>
            <span className="up-main">Upload statement PDF</span>
            <span className="up-sub">
              bank / UPI statement · parsed &amp; reviewed before saving
            </span>
          </button>
        </section>

        <Tabs />
        <Toolbar />

        {tab === "ledger" && <LedgerView />}
        {tab === "upi" && <UpiView />}
        {tab === "split" && <SplitView />}
        {tab === "pay" && <PayView />}
        {tab === "people" && <PeopleView />}
      </main>

      <RegisterModal />
      <PreviewModal />
      <Toasts />
    </div>
  );
}
