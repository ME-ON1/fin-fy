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
  for (const r of rows) if (r.date === day) r.type === "debit" ? (out += r.amount) : (inc += r.amount);
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
  const subParts = [];
  if (t.remarks) subParts.push(`“${esc(t.remarks)}”`);
  if (t.counterparty_upi) subParts.push(esc(t.counterparty_upi));
  if (t.account_name) subParts.push(esc(t.account_name));
  return `
    <div class="tx" data-id="${t.id}">
      <div class="tx-main">
        <div class="tx-desc">${esc(t.description)}</div>
        <div class="tx-sub">${subParts.join(" · ")}</div>
        <div class="tx-badges">${badges.join("")}</div>
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
