/* fin-fy frontend — mobile-first ledger + UPI summary + PDF upload */

"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];


const DEVICE_KEY = "finfy_device_id";
const FP_KEY = "finfy_fp";

function makeDeviceId() {
  // crypto.randomUUID is only available in secure contexts (https / localhost);
  // on plain http over LAN it doesn't exist, so fall back to a random string.
  try {
    if (window.crypto && typeof crypto.randomUUID === "function" && window.crypto && window.crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    }
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  }
  return "dev-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 18);
}
const state = {
  deviceId: localStorage.getItem(DEVICE_KEY) || null,
  fingerprint: null,
  me: null,
  members: [],
  month: new Date().toISOString().slice(0, 7),
  tab: "ledger",
  preview: null, // { account, transactions, source_file }
};

function getFingerprint(force = false) {
  // The fingerprint is stable per device — cache it so browser-update drift
  // doesn't lock anyone out; recompute only when missing or forced.
  if (!force && state.fingerprint) return state.fingerprint;
  let fp = force ? null : localStorage.getItem(FP_KEY);
  if (!fp) {
    try { fp = window.finfyFingerprint.compute().hash; } catch { return null; }
    if (fp) localStorage.setItem(FP_KEY, fp);
  }
  state.fingerprint = fp;
  return fp;
}

/* ---------------- api helpers ---------------- */

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.deviceId) headers["X-Device-Id"] = state.deviceId;
  const fp = getFingerprint();
  if (fp) headers["X-Device-Fp"] = fp;
  if (opts.body && !(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch {}
    if (detail === "device_not_recognized" && res.status === 403) {
      // fingerprint not bound to any member: re-auth this device
      state.me = null;
      openRegister("This device isn't recognized. Enter your name and PIN to use it.");
      return null;
    }
    throw new Error(detail);
  }
  return res.json();
}

/* ---------------- toast ---------------- */

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ---------------- device / member ---------------- */

function fmtMoney(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

async function ensureMember() {
  if (!getFingerprint()) { openRegister(); return null; }
  try {
    state.me = await api(`/api/members/me`);
  } catch { state.me = null; }
  if (state.me === null) openRegister();
  return state.me;
}

function openRegister(note) {
  $("#registerModal").hidden = false;
  $("#regError").hidden = true;
  $("#regError").textContent = note || "";
  setTimeout(() => $("#regName").focus(), 100);
}

async function saveRegistration() {
  const name = $("#regName").value.trim();
  if (!name) { $("#regError").textContent = "Please enter your name."; $("#regError").hidden = false; return; }
  if (!state.deviceId) {
    state.deviceId = makeDeviceId();
    localStorage.setItem(DEVICE_KEY, state.deviceId);
  }
  const fp = getFingerprint(true); // recompute: this is the moment of truth
  if (!fp) { $("#regError").textContent = "Couldn't fingerprint this device."; $("#regError").hidden = false; return; }
  try {
    state.me = await api("/api/members/register", {
      method: "POST",
      body: JSON.stringify({
        name,
        device_id: state.deviceId,
        upi_id: $("#regUpi").value.trim() || null,
        pin: $("#regPin").value.trim() || null,
      }),
    });
    if (state.me === null) return; // 403 re-auth path already opened the modal
    if (state.me.name !== name) {
      toast(`This device is already registered to ${state.me.name} — welcome back!`, "ok");
    } else {
      toast(`Welcome, ${name}! 👋`, "ok");
    }
    $("#registerModal").hidden = true;
    renderMemberChip();
    await loadAll();
  } catch (e) {
    $("#regError").textContent = e.message;
    $("#regError").hidden = false;
  }
}

function renderMemberChip() {
  if (state.me) {
    $("#memberName").textContent = state.me.name;
    $("#memberPhone").textContent = state.me.phone_model || "device";
  } else {
    $("#memberName").textContent = "Not registered";
    $("#memberPhone").textContent = "tap to set name";
  }
}

/* ---------------- tabs ---------------- */

function setTab(tab) {
  state.tab = tab;
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${tab}`));
  if (tab === "ledger") loadLedger();
  if (tab === "upi") loadUpi();
  if (tab === "split") loadSplit();
  if (tab === "pay") initPayTab();
  if (tab === "people") loadPeople();
}

/* ---------------- ledger view ---------------- */

const CAT_LABELS = {
  groceries: "🛒", transport: "🚕", food: "🍜", shopping: "🛍️",
  utilities: "💡", health: "💊", entertainment: "🎬", income: "💰",
  transfer: "🔁", other: "📄",
};

async function loadLedger() {
  const q = new URLSearchParams({ month: state.month });
  if (state.filterMember) q.set("member_id", state.filterMember);
  let data;
  try { data = await api(`/api/views/ledger?${q}`); }
  catch (e) { toast(e.message, "err"); return; }
  if (!data || !data.summary) return;

  const s = data.summary;
  const cards = $("#summaryCards");
  cards.innerHTML = `
    <div class="sum-card"><div class="label">Spent</div><div class="value neg">${fmtMoney(s.total_spent)}</div></div>
    <div class="sum-card"><div class="label">Received</div><div class="value pos">${fmtMoney(s.total_received)}</div></div>
    <div class="sum-card"><div class="label">Shared spend</div><div class="value amber">${fmtMoney(s.shared_spent)}</div></div>
    <div class="sum-card"><div class="label">Net</div><div class="value ${s.net >= 0 ? "pos" : "neg"}">${fmtMoney(s.net)}</div></div>
    <div class="sum-card wide"><div class="label">By category</div><div class="value">${categoryLine(s.by_category)}</div></div>
    ${s.pending_count ? `<div class="sum-card wide"><div class="label">⏳ ${s.pending_count} payment(s) unconfirmed — excluded from totals until marked</div><div class="value"></div></div>` : ""}
    <div class="sum-card wide" style="padding:8px;text-align:center"><button class="btn-inline" id="goSplit">🧮 View split-wise ▶</button></div>
  `;

  const list = $("#ledgerList");
  if (!data.rows.length) {
    list.innerHTML = `<div class="empty">No transactions for this month.<br>Upload a statement PDF above ☝️</div>`;
    return;
  }
  let html = "";
  let curDay = null;
  for (const t of data.rows) {
    const day = t.date;
    if (day !== curDay) {
      curDay = day;
      html += `<div class="day-group"><div class="day-head"><span>${fmtDay(day)}</span><span>${dayTotal(data.rows, day)}</span></div>`;
    }
    html += txRow(t);
  }
  html += "</div>";
  list.innerHTML = html;
}

function dayTotal(rows, day) {
  let out = 0, inc = 0;
  for (const r of rows) {
    if (r.date !== day || r.status !== "success") continue;
    r.type === "debit" ? (out += r.amount) : (inc += r.amount);
  }
  const parts = [];
  if (out) parts.push(`<span style="color:var(--red)">${fmtMoney(out)}</span>`);
  if (inc) parts.push(`<span style="color:var(--green)">${fmtMoney(inc)}</span>`);
  return parts.join("&nbsp;&nbsp;");
}

function txRow(t) {
  const badges = [`<span class="badge cat">${CAT_LABELS[t.category] || ""} ${t.category}</span>`];
  badges.push(`<span class="badge member">${esc(t.member_name)}</span>`);
  if (t.is_shared) {
    const who = t.shared_with_name ? ` ↔ ${esc(t.shared_with_name)}` : "";
    badges.push(`<span class="badge shared">🤝 both${who}</span>`);
  }
  const pending = t.status === "pending";
  if (pending) badges.push(`<span class="badge pending">⏳ pending</span>`);
  const subParts = [];
  if (t.remarks) subParts.push(`“${esc(t.remarks)}”`);
  if (t.counterparty_upi) subParts.push(esc(t.counterparty_upi));
  if (t.account_name) subParts.push(esc(t.account_name));
  return `
    <div class="tx${pending ? " tx-pending" : ""}" data-id="${t.id}">
      <div class="tx-main">
        <div class="tx-desc">${esc(t.description)}</div>
        <div class="tx-sub">${subParts.join(" · ")}</div>
        <div class="tx-badges">${badges.join("")}</div>
        ${pending ? `<div class="tx-confirm">Was it paid? <button class="badge-btn ok" data-id="${t.id}" data-status="success">✓ yes</button><button class="badge-btn bad" data-id="${t.id}" data-status="failed">✗ no</button></div>` : ""}
      </div>
      <div class="tx-amt ${t.type}">${t.type === "debit" ? "−" : "+"}${fmtMoney(t.amount)}</div>
    </div>`;
}

function categoryLine(byCat) {
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "—";
  return entries.slice(0, 5).map(([c, v]) => `${CAT_LABELS[c] || ""} ${c}: ${fmtMoney(v)}`).join(" · ");
}

/* ---------------- by UPI view ---------------- */

async function loadUpi() {
  const q = new URLSearchParams({ month: state.month });
  if (state.filterMember) q.set("member_id", state.filterMember);
  let data;
  try { data = await api(`/api/views/upi-summary?${q}`); }
  catch (e) { toast(e.message, "err"); return; }
  if (!data || !data.buckets) return;

  const list = $("#upiList");
  if (!data.buckets.length) {
    list.innerHTML = `<div class="empty">No payments this month.</div>`;
    return;
  }
  list.innerHTML = `
    <div class="upi-card" style="pointer-events:none">
      <div class="upi-head">
        <div class="upi-id"><div class="vpa" style="color:var(--muted);font-size:12px">TOTAL PAID</div></div>
        <div class="upi-total" style="color:var(--text)">${fmtMoney(data.total_spent)}</div>
      </div>
    </div>`;
  for (const b of data.buckets) {
    const name = b.counterparty_upi || b.counterparty || "other";
    const rows = b.transactions.map(txRow).join("");
    list.insertAdjacentHTML("beforeend", `
      <div class="upi-card">
        <div class="upi-head">
          <div class="upi-id">
            <div class="vpa">${esc(name)}</div>
            <div class="meta">${b.count} payment${b.count > 1 ? "s" : ""}${b.shared_total ? ` · 🤝 ${fmtMoney(b.shared_total)} shared` : ""}</div>
          </div>
          <div class="upi-total">${fmtMoney(b.total)}<span class="sub">${b.shared_total ? "incl. shared" : ""}</span></div>
        </div>
        <div class="upi-body">${rows}</div>
      </div>`);
  }
  $$(".upi-head").forEach((h) => h.addEventListener("click", () => h.parentElement.classList.toggle("open")));
}

/* ---------------- people view ---------------- */

async function loadPeople() {
  let data;
  try { data = await api("/api/views/members-summary"); }
  catch (e) { toast(e.message, "err"); return; }
  if (!data || !data.members) return;
  const list = $("#peopleList");
  if (!data.members.length) {
    list.innerHTML = `<div class="empty">No members yet. Register your name from the top-right chip.</div>`;
    return;
  }
  list.innerHTML = data.members.map((m) => `
    <div class="person-card">
      <div class="pname">${esc(m.name)}</div>
      <div class="psub">📱 ${esc(m.phone_model || "unknown device")}</div>
      <div class="person-stats">
        <div class="stat"><div class="v" style="color:var(--red)">${fmtMoney(m.total_paid)}</div><div class="l">paid</div></div>
        <div class="stat"><div class="v" style="color:var(--amber)">${fmtMoney(m.shared_paid)}</div><div class="l">shared (their half owes back)</div></div>
      </div>
    </div>`).join("");
}

/* ---------------- split view ---------------- */

async function loadSplit() {
  const q = new URLSearchParams({ month: state.month });
  if (state.filterMember) q.set("member_id", state.filterMember);
  let data;
  try { data = await api(`/api/views/split?${q}`); }
  catch (e) { toast(e.message, "err"); return; }
  if (!data || !data.transactions) return;

  let cards = `
    <div class="sum-card"><div class="label">Shared txns</div><div class="value amber">${data.shared_count}</div></div>
    <div class="sum-card"><div class="label">Shared total</div><div class="value amber">${fmtMoney(data.shared_total)}</div></div>`;
  if (data.unsettled_count) {
    cards += `<div class="sum-card wide"><div class="label">⚠️ ${data.unsettled_count} shared txn(s) have no partner selected — the split shows only when a partner is set</div><div class="value"></div></div>`;
  }
  $("#splitCards").innerHTML = cards;

  const settle = $("#settlements");
  if (data.settlements.length) {
    settle.innerHTML = data.settlements.map((s) => `
      <div class="settle-card">
        <div class="settle-arrow">🔁</div>
        <div class="settle-names"><span class="who">pays</span>${esc(s.owes)} → ${esc(s.to)}</div>
        <div class="settle-amt">${fmtMoney(s.amount)}</div>
      </div>`).join("");
  } else {
    settle.innerHTML = `<div class="empty">No settlements this month.</div>`;
  }

  const list = $("#splitList");
  if (!data.transactions.length) {
    list.innerHTML = `<div class="empty">No shared ("both") transactions this month.</div>`;
    return;
  }
  let html = "";
  let curDay = null;
  for (const t of data.transactions) {
    const day = t.date;
    if (day !== curDay) { curDay = day; html += `<div class="day-group"><div class="day-head"><span>${fmtDay(day)}</span></div>`; }
    const who = t.other
      ? `${esc(t.payer)} ↔ ${esc(t.other)} · each pays ${fmtMoney(t.each_pays)}`
      : `${esc(t.payer)} · no partner set`;
    html += `
      <div class="tx split-row">
        <div class="tx-main">
          <div class="tx-desc">🤝 ${esc(t.description)}</div>
          <div class="tx-sub">${who}</div>
        </div>
        <div class="tx-amt">${fmtMoney(t.amount)}<span class="split-half"><br>${t.other ? `→ ${fmtMoney(t.each_pays)} each` : ""}</span></div>
      </div>`;
  }
  html += "</div>";
  list.innerHTML = html;
}

/* ---------------- upload flow ---------------- */

function openFilePicker() {
  if (!state.me) { toast("Register your name first", "err"); openRegister(); return; }
  $("#fileInput").click();
}

async function handleFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name)) { toast("Only PDF files supported", "err"); return; }
  toast("Parsing statement…");
  const fd = new FormData();
  fd.append("file", file);
  try {
    const preview = await api("/api/upload", { method: "POST", body: fd });
    state.preview = preview;
    renderPreview();
  } catch (e) {
    toast(`Upload failed: ${e.message}`, "err");
  }
}

function renderPreview() {
  const p = state.preview;
  if (!p) return;
  const rows = $("#previewRows");
  rows.innerHTML = "";
  p.transactions.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "prow";
    row.innerHTML = `
      <div class="prow-top">
        <div class="prow-date">${t.date}</div>
        <div class="prow-desc">${esc(t.description)}${t.remarks ? `<br><span class="muted">“${esc(t.remarks)}”</span>` : ""}</div>
        <div class="prow-amt ${t.type}">${t.type === "debit" ? "−" : "+"}${fmtMoney(t.amount)}</div>
      </div>
      <div class="prow-fields">
        <input type="text" class="prow-remarks" placeholder="remarks…" value="${esc(t.remarks || "")}">
        <select class="prow-cat">${Object.keys(CAT_LABELS).map((c) => `<option ${c === t.category ? "selected" : ""}>${c}</option>`).join("")}</select>
        <label class="prow-toggle"><input type="checkbox" ${t.is_shared ? "checked" : ""}> both</label>
        <select class="prow-shared" ${t.is_shared ? "" : "disabled"} hidden>
          <option value="">with…</option>
          ${state.members.filter((m) => m.id !== state.me.id).map((m) => `<option value="${m.id}" ${m.name === t.shared_hint ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
        </select>
        <button class="prow-del" title="Remove row">✕</button>
      </div>`;
    rows.appendChild(row);

    const toggle = row.querySelector(".prow-toggle input");
    const sharedSel = row.querySelector(".prow-shared");
    const syncShared = () => {
      sharedSel.hidden = !toggle.checked;
      sharedSel.disabled = !toggle.checked;
    };
    toggle.addEventListener("change", syncShared);
    syncShared();
    row.querySelector(".prow-del").addEventListener("click", () => {
      p.transactions.splice(i, 1);
      renderPreview();
    });
    row.querySelector(".prow-remarks").addEventListener("input", (e) => (t.remarks = e.target.value || null));
    row.querySelector(".prow-cat").addEventListener("change", (e) => (t.category = e.target.value));
    sharedSel.addEventListener("change", (e) => (t.shared_with_id = e.target.value || null));
  });

  const meta = $("#previewMeta");
  meta.innerHTML = "";
  if (p.account?.name) meta.insertAdjacentHTML("beforeend", `<span>Account: <b>${esc(p.account.name)}</b></span>`);
  if (p.account?.upi_id) meta.insertAdjacentHTML("beforeend", `<span>UPI: <b>${esc(p.account.upi_id)}</b></span>`);
  meta.insertAdjacentHTML("beforeend", `<span>File: <b>${esc(p.source_file)}</b></span>`);

  const warn = $("#previewWarnings");
  warn.innerHTML = p.warnings.length ? p.warnings.map((w) => `<div>⚠️ ${esc(w)}</div>`).join("") : "";

  $("#previewCount").textContent = p.transactions.length;
  $("#previewModal").hidden = false;
}

async function savePreview(goSplit = false) {
  const p = state.preview;
  if (!p || !p.transactions.length) { toast("Nothing to save", "err"); return; }
  const payload = {
    account: p.account?.name || p.account?.upi_id ? { name: p.account.name, upi_id: p.account.upi_id } : null,
    transactions: p.transactions.map((t) => ({
      date: t.date,
      description: t.description,
      remarks: t.remarks,
      category: t.category,
      counterparty: t.counterparty,
      counterparty_upi: t.counterparty_upi,
      upi_ref: t.upi_ref,
      amount: t.amount,
      type: t.type,
      is_shared: !!t.is_shared,
      shared_with_id: t.is_shared ? t.shared_with_id || null : null,
    })),
    source_file: p.source_file,
  };
  try {
    const res = await api(`/api/transactions/batch?member_id=${state.me.id}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    toast(`Saved ${res.created} transactions ✅`, "ok");
    $("#previewModal").hidden = true;
    state.preview = null;
    loadAll();
    if (goSplit) setTab("split");
  } catch (e) {
    toast(`Save failed: ${e.message}`, "err");
  }
}

/* ---------------- pay / QR deep-link ---------------- */

const NOTE_PRESETS = [
  { label: "Uber · both", note: "uber both", both: true },
  { label: "Uber · solo", note: "uber single", both: false },
  { label: "Ola · both", note: "ola both", both: true },
  { label: "Ola · solo", note: "ola single", both: false },
  { label: "Cab · both", note: "cab both", both: true },
  { label: "Cab · solo", note: "cab single", both: false },
  { label: "Swiggy · both", note: "swiggy both", both: true },
  { label: "Swiggy · solo", note: "swiggy single", both: false },
  { label: "Zomato · both", note: "zomato both", both: true },
  { label: "Zomato · solo", note: "zomato single", both: false },
  { label: "Food · both", note: "food both", both: true },
  { label: "Food · solo", note: "food single", both: false },
  { label: "Groceries · both", note: "groceries", both: true },
  { label: "Shopping · both", note: "shopping both", both: true },
  { label: "Shopping · solo", note: "shopping single", both: false },
];

const PAY_KEY = "finfy_pay";
let payState = null; // { pa, pn, am, cu, note }

function parseUpiQr(text) {
  let s = String(text || "").trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "upi://pay?" + s.replace(/^\?/, "");
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!["upi:", "tez:", "gpay:"].includes(u.protocol)) return null;
  const p = u.searchParams;
  return {
    pa: p.get("pa"),
    pn: p.get("pn"),
    am: p.get("am"),
    cu: p.get("cu") || "INR",
    tn: p.get("tn") || "",
  };
}

function buildTezUrl(q) {
  const p = new URLSearchParams();
  if (q.pa) p.set("pa", q.pa);
  if (q.pn) p.set("pn", q.pn);
  if (q.am) p.set("am", q.am);
  p.set("cu", q.cu || "INR");
  if (q.note) p.set("tn", q.note);
  return "tez://upi/pay?" + p.toString().replace(/\+/g, "%20");
}

function guessPayCategory(note) {
  const n = (note || "").toLowerCase();
  if (/uber|ola|cab|taxi|auto|rapido|metro|petrol|fuel|parking|toll/.test(n)) return "transport";
  if (/swiggy|zomato|food|restaurant|hotel|tea|coffee|dominos|kfc|pizza/.test(n)) return "food";
  if (/grocer|dmart|blinkit|bigbasket|mart|kirana|sabji/.test(n)) return "groceries";
  if (/shop|amazon|flipkart|myntra|mall|store/.test(n)) return "shopping";
  return "other";
}

function decodeQrFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1024 / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(data.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
        URL.revokeObjectURL(url);
        if (code && code.data) resolve(code.data);
        else reject(new Error("No QR code found in that image"));
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image")); };
    img.src = url;
  });
}

function initPayTab() {
  if (!state.me) { openRegister(); return; }
  // resume an in-flight payment (e.g. page reloaded while paying)
  if (sessionStorage.getItem(PAY_KEY)) { showPayResult(); return; }
  if (!payState) { renderNoteChips(null); }
}

function renderNoteChips(selectedNote) {
  const wrap = $("#noteChips");
  wrap.innerHTML = NOTE_PRESETS.map((p) =>
    `<button class="note-chip${p.both ? " both" : ""}${p.note === selectedNote ? " active" : ""}" data-note="${esc(p.note)}">${esc(p.label)}</button>`
  ).join("");
  $$("#noteChips .note-chip").forEach((c) =>
    c.addEventListener("click", () => {
      $$("#noteChips .note-chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      $("#payNote").value = c.dataset.note;
    })
  );
  if (selectedNote && !NOTE_PRESETS.some((p) => p.note === selectedNote)) {
    $("#payNote").value = selectedNote;
  }
}

async function onQrFile(file) {
  if (!file) return;
  toast("Reading QR…");
  let text;
  try { text = await decodeQrFile(file); }
  catch (e) { toast(e.message, "err"); return; }
  const q = parseUpiQr(text);
  if (!q || !q.pa) { toast("That QR isn't a UPI payment code", "err"); return; }
  applyPay(q);
}

function applyPay(q) {
  payState = { pa: q.pa, pn: q.pn, am: q.am || "", cu: q.cu || "INR", note: q.tn || "" };
  $("#pmName").textContent = q.pn || "Merchant";
  $("#pmUpi").textContent = q.pa;
  $("#payAmount").value = q.am || "";
  $("#payUpiManual").hidden = true;
  $("#payUpiManual").value = "";
  renderNoteChips(q.tn || null);
  $("#payResult").hidden = true;
  $("#payWaiting").hidden = true;
  $("#payIdle").hidden = true;
  $("#payForm").hidden = false;
  $("#payAmount").focus();
}

function startPay() {
  if (!state.me) { openRegister(); return; }
  const am = parseFloat($("#payAmount").value);
  if (!am || am <= 0) { toast("Enter an amount", "err"); return; }
  const manual = $("#payUpiManual").value.trim();
  const pa = (payState && payState.pa) || manual || null;
  const pn = payState ? payState.pn : null;
  if (!pa) { toast("No merchant UPI id", "err"); return; }
  const note = $("#payNote").value.trim();
  payState = { pa, pn, am: String(am), cu: "INR", note };
  sessionStorage.setItem(PAY_KEY, JSON.stringify(payState));
  $("#payForm").hidden = true;
  $("#payWaiting").hidden = false;
  window.location.href = buildTezUrl(payState);
}

function showPayResult() {
  const raw = sessionStorage.getItem(PAY_KEY);
  if (!raw) { $("#payWaiting").hidden = true; $("#payIdle").hidden = false; return; }
  try { payState = JSON.parse(raw); } catch { return; }
  $("#resultSub").textContent =
    `${fmtMoney(payState.am)} to ${payState.pn || payState.pa}` +
    (payState.note ? ` · “${payState.note}”` : "");
  $("#payWaiting").hidden = true;
  $("#payForm").hidden = true;
  $("#payIdle").hidden = true;
  $("#payResult").hidden = false;
}

function resetPay() {
  sessionStorage.removeItem(PAY_KEY);
  payState = null;
  $("#payResult").hidden = true;
  $("#payWaiting").hidden = true;
  $("#payForm").hidden = true;
  $("#payIdle").hidden = false;
  $("#payAmount").value = "";
  $("#payNote").value = "";
  renderNoteChips(null);
}

async function savePaidTransaction(status) {
  if (!payState) return;
  const note = payState.note || "";
  const category = guessPayCategory(note);
  const isShared = /\bboth\b/i.test(note) || category === "groceries";
  let sharedWithId = null;
  if (isShared) {
    const others = state.members.filter((m) => m.id !== state.me.id);
    if (others.length === 1) sharedWithId = others[0].id;
  }
  const payload = {
    transactions: [{
      date: new Date().toISOString().slice(0, 10),
      description: `UPI payment to ${payState.pn || payState.pa}`,
      remarks: note || null,
      category,
      counterparty: payState.pn || null,
      counterparty_upi: payState.pa,
      amount: parseFloat(payState.am),
      type: "debit",
      is_shared: isShared,
      shared_with_id: sharedWithId,
      status,
    }],
    source_file: null,
  };
  try {
    const res = await api("/api/transactions/batch", { method: "POST", body: JSON.stringify(payload) });
    if (res === null) return;
    if (status === "pending") {
      toast(`Saved as pending — not counted until confirmed ⏳`, "ok");
    } else {
      toast(`Saved ✓ ${fmtMoney(payState.am)}${isShared ? " · shared" : ""}`, "ok");
    }
    resetPay();
    loadAll();
  } catch (e) {
    toast(`Save failed: ${e.message}`, "err");
  }
}

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDay(d) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

async function loadAll() {
  await Promise.all([loadLedger(), loadUpi()]);
  if (state.tab === "people") loadPeople();
}

/* ---------------- init ---------------- */

async function init() {
  $("#uploadBtn").addEventListener("click", openFilePicker);
  $("#fileInput").addEventListener("change", (e) => handleFile(e.target.files[0]));
  $("#regSave").addEventListener("click", saveRegistration);
  $("#regName").addEventListener("keydown", (e) => { if (e.key === "Enter") saveRegistration(); });
  $("#regPin").addEventListener("keydown", (e) => { if (e.key === "Enter") saveRegistration(); });
  $("#memberChip").addEventListener("click", () => {
    if (state.me) {
      toast(`This device is registered to ${state.me.name} — one device = one person.`, "ok");
      return;
    }
    openRegister();
  });
  $("#previewSave").addEventListener("click", () => savePreview(false));
  $("#previewSaveSplit").addEventListener("click", () => savePreview(true));
  $("#previewCancel").addEventListener("click", () => { $("#previewModal").hidden = true; state.preview = null; });
  $("#summaryCards").addEventListener("click", (e) => { if (e.target.closest("#goSplit")) setTab("split"); });
  // mark pending transactions as success/failed from the ledger
  $("#ledgerList").addEventListener("click", async (e) => {
    const btn = e.target.closest(".badge-btn");
    if (!btn) return;
    try {
      const res = await api(`/api/transactions/${btn.dataset.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: btn.dataset.status }),
      });
      if (res === null) return;
      toast(btn.dataset.status === "success" ? "Marked as paid ✓" : "Marked as failed", "ok");
      loadAll();
    } catch (err) { toast(err.message, "err"); }
  });
  // pay / QR
  $("#scanBtn").addEventListener("click", () => {
    if (!state.me) { openRegister(); return; }
    $("#qrInput").click();
  });
  $("#qrInput").addEventListener("change", (e) => { onQrFile(e.target.files[0]); e.target.value = ""; });
  $("#manualBtn").addEventListener("click", () => {
    if (!state.me) { openRegister(); return; }
    payState = { pa: null, pn: null, am: "", cu: "INR", note: "" };
    $("#pmName").textContent = "Manual entry";
    $("#pmUpi").textContent = "enter the UPI id below";
    $("#payUpiManual").hidden = false;
    $("#payAmount").value = "";
    renderNoteChips(null);
    $("#payIdle").hidden = true;
    $("#payForm").hidden = false;
    $("#payUpiManual").focus();
  });
  $("#payNow").addEventListener("click", startPay);
  $("#backFromGpay").addEventListener("click", showPayResult);
  $("#resultSuccess").addEventListener("click", () => savePaidTransaction("success"));
  $("#resultPending").addEventListener("click", () => savePaidTransaction("pending"));
  $("#resultFail").addEventListener("click", () => { toast("Not saved — payment failed", "err"); resetPay(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && sessionStorage.getItem(PAY_KEY) && state.tab === "pay") showPayResult();
  });
  $$(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("#monthPicker").addEventListener("change", (e) => { state.month = e.target.value; loadAll(); });
  $("#memberFilter").addEventListener("change", (e) => { state.filterMember = e.target.value; loadAll(); });

  $("#monthPicker").value = state.month;

  // device identity first (register / auto-login via fingerprint), then members
  await ensureMember();
  if (state.me) {
    renderMemberChip();
    const members = await api("/api/members").catch(() => []);
    if (members) {
      state.members = members;
      $("#memberFilter").innerHTML = `<option value="">Everyone</option>` +
        members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("");
    }
    loadAll();
  }
}

init();
