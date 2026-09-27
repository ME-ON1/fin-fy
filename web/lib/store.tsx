"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEVICE_KEY,
  FP_KEY,
  PAY_KEY,
} from "./constants";
import {
  computeFingerprint,
  getCachedFingerprint,
  loadDeviceId,
  makeDeviceId,
  storeDeviceId,
} from "./device";
import type { BatchResult, Member, UploadPreview } from "./types";

export type TabId = "ledger" | "upi" | "split" | "pay" | "people";
type ToastKind = "" | "ok" | "err";

export interface ApiOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
}

export type ApiFn = <T = unknown>(
  path: string,
  opts?: ApiOpts,
) => Promise<T | null>;

interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
}

interface RegisterState {
  open: boolean;
  note?: string;
}

interface AppContextValue {
  deviceId: string | null;
  me: Member | null;
  members: Member[];
  month: string;
  filterMember: string;
  tab: TabId;
  version: number;
  api: ApiFn;
  toast: (msg: string, kind?: ToastKind) => void;
  toasts: Toast[];
  setMonth: (m: string) => void;
  setFilterMember: (m: string) => void;
  setTab: (t: TabId) => void;
  bump: () => void;
  registerState: RegisterState;
  openRegister: (note?: string) => void;
  closeRegister: () => void;
  saveRegistration: (name: string, upi: string, pin: string) => Promise<void>;
  preview: UploadPreview | null;
  setPreview: (p: UploadPreview | null) => void;
  savePreview: (p: UploadPreview, goSplit?: boolean) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function AppProvider({ children }: { children: ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [me, setMe] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [month, setMonth] = useState<string>(currentMonth);
  const [filterMember, setFilterMember] = useState<string>("");
  const [tab, setTab] = useState<TabId>("ledger");
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [registerState, setRegisterState] = useState<RegisterState>({
    open: false,
  });
  const [preview, setPreview] = useState<UploadPreview | null>(null);

  const deviceIdRef = useRef<string | null>(null);
  const toastSeq = useRef(0);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const toast = useCallback((msg: string, kind: ToastKind = "") => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const openRegister = useCallback((note?: string) => {
    setRegisterState({ open: true, note });
  }, []);

  const closeRegister = useCallback(() => {
    setRegisterState((s) => ({ ...s, open: false }));
  }, []);

  const api = useCallback(
    async <T,>(path: string, opts: ApiOpts = {}): Promise<T | null> => {
      const headers: Record<string, string> = { ...(opts.headers || {}) };
      if (deviceIdRef.current) headers["X-Device-Id"] = deviceIdRef.current;
      const fp = getCachedFingerprint();
      if (fp) headers["X-Device-Fp"] = fp;
      if (opts.body && !(opts.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetch(path, { ...opts, headers });
      if (!res.ok) {
        let detail = res.statusText;
        try {
          detail = (await res.json()).detail || detail;
        } catch {
          /* non-json error body */
        }
        if (detail === "device_not_recognized" && res.status === 403) {
          // fingerprint not bound to any member: re-auth this device
          setMe(null);
          openRegister(
            "This device isn't recognized. Enter your name and PIN to use it.",
          );
          return null;
        }
        throw new Error(detail);
      }
      return (await res.json()) as T;
    },
    [openRegister],
  );

  // ---- device identity + auto-login via fingerprint ----
  useEffect(() => {
    const existing = loadDeviceId();
    deviceIdRef.current = existing;
    setDeviceId(existing);

    (async () => {
      if (!getCachedFingerprint()) {
        openRegister();
        return;
      }
      let m: Member | null = null;
      try {
        m = await api<Member | null>("/api/members/me");
      } catch {
        m = null;
      }
      if (m === null) {
        openRegister();
        return;
      }
      setMe(m);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- members list (needed by filters + shared-with pickers) ----
  useEffect(() => {
    if (!me) return;
    let alive = true;
    api<Member[]>("/api/members")
      .then((list) => {
        if (alive && list) setMembers(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [me, api, version]);

  const saveRegistration = useCallback(
    async (name: string, upi: string, pin: string) => {
      let id = deviceIdRef.current;
      if (!id) {
        id = makeDeviceId();
        storeDeviceId(id);
        deviceIdRef.current = id;
        setDeviceId(id);
      }
      // recompute at the moment of truth
      const fp = getCachedFingerprint(true);
      if (!fp) throw new Error("Couldn't fingerprint this device.");

      const m = await api<Member | null>("/api/members/register", {
        method: "POST",
        body: JSON.stringify({
          name,
          device_id: id,
          upi_id: upi.trim() || null,
          pin: pin.trim() || null,
        }),
      });
      if (m === null) return; // 403 re-auth path already opened the modal
      setMe(m);
      setRegisterState({ open: false });
      if (m.name !== name) {
        toast(`This device is already registered to ${m.name} — welcome back!`, "ok");
      } else {
        toast(`Welcome, ${name}! 👋`, "ok");
      }
      bump();
    },
    [api, toast, bump],
  );

  const savePreview = useCallback(
    async (p: UploadPreview, goSplit = false) => {
      if (!p || !p.transactions.length) {
        toast("Nothing to save", "err");
        return;
      }
      if (!me) return;
      const payload = {
        account:
          p.account?.name || p.account?.upi_id
            ? { name: p.account?.name, upi_id: p.account?.upi_id }
            : null,
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
        const res = await api<BatchResult>(
          `/api/transactions/batch?member_id=${me.id}`,
          { method: "POST", body: JSON.stringify(payload) },
        );
        if (res === null) return;
        toast(`Saved ${res.created} transactions ✅`, "ok");
        setPreview(null);
        bump();
        if (goSplit) setTab("split");
      } catch (e) {
        toast(`Save failed: ${(e as Error).message}`, "err");
      }
    },
    [api, me, toast, bump],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      deviceId,
      me,
      members,
      month,
      filterMember,
      tab,
      version,
      api,
      toast,
      toasts,
      setMonth,
      setFilterMember,
      setTab,
      bump,
      registerState,
      openRegister,
      closeRegister,
      saveRegistration,
      preview,
      setPreview,
      savePreview,
    }),
    [
      deviceId,
      me,
      members,
      month,
      filterMember,
      tab,
      version,
      api,
      toast,
      toasts,
      bump,
      registerState,
      openRegister,
      closeRegister,
      saveRegistration,
      preview,
      savePreview,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** Session-scoped in-flight payment, survives a Google Pay round-trip. */
export function loadPayState(): unknown | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PAY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function savePayState(state: unknown): void {
  sessionStorage.setItem(PAY_KEY, JSON.stringify(state));
}

export function clearPayState(): void {
  sessionStorage.removeItem(PAY_KEY);
}

export { DEVICE_KEY, FP_KEY, PAY_KEY, computeFingerprint };
