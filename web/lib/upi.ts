import jsQR from "jsqr";
import type { Category } from "./types";

export interface UpiQuery {
  pa: string;
  pn: string | null;
  am: string | null;
  cu: string;
  tn: string;
}

/** Parse a scanned UPI / Google Pay QR payload into its query params. */
export function parseUpiQr(text: string): UpiQuery | null {
  let s = String(text || "").trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = "upi://pay?" + s.replace(/^\?/, "");
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!["upi:", "tez:", "gpay:"].includes(u.protocol)) return null;
  const p = u.searchParams;
  return {
    pa: p.get("pa") || "",
    pn: p.get("pn"),
    am: p.get("am"),
    cu: p.get("cu") || "INR",
    tn: p.get("tn") || "",
  };
}

export interface PayState {
  pa: string | null;
  pn: string | null;
  am: string;
  cu: string;
  note: string;
}

export function buildTezUrl(q: PayState): string {
  const p = new URLSearchParams();
  if (q.pa) p.set("pa", q.pa);
  if (q.pn) p.set("pn", q.pn);
  if (q.am) p.set("am", q.am);
  p.set("cu", q.cu || "INR");
  if (q.note) p.set("tn", q.note);
  return (
    "tez://upi/pay?" +
    p.toString().replace(/\+/g, "%20") +
    "aid=uGICAgIC1lKfVLQ" +
    "mc=" +
    "tr=b76ec8450672"
  );
}

/* ---- payee address: VPA (name@bank) or phone number ---- */

export function isVpa(s: string): boolean {
  return /^[\w.-]+@[\w.-]+$/.test((s || "").trim());
}

/** -> "+919876543210" or null */
export function normalizePhone(s: string): string | null {
  const d = String(s || "").replace(/[^\d]/g, "");
  if (d.length === 10) return "+91" + d;
  if (d.length === 11 && d[0] === "0") return "+91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91")) return "+91" + d.slice(2);
  if (d.length === 12) return "+" + d; // other country code
  return null;
}

/** Accept a VPA as-is, or turn a phone number into the UPI phone format. */
export function normalizePayee(input: string): string | null {
  const s = (input || "").trim();
  if (isVpa(s)) return s;
  const ph = normalizePhone(s);
  if (ph) return ph;
  return null;
}

export function guessPayCategory(note: string): Category {
  const n = (note || "").toLowerCase();
  if (/uber|ola|cab|taxi|auto|rapido|metro|petrol|fuel|parking|toll/.test(n))
    return "transport";
  if (/swiggy|zomato|food|restaurant|hotel|tea|coffee|dominos|kfc|pizza/.test(n))
    return "food";
  if (/grocer|dmart|blinkit|bigbasket|mart|kirana|sabji/.test(n))
    return "groceries";
  if (/shop|amazon|flipkart|myntra|mall|store/.test(n)) return "shopping";
  return "other";
}

/** Decode a QR image file (from camera or gallery) to its raw payload. */
export function decodeQrFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1024 / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Couldn't read that image"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(data.data, canvas.width, canvas.height, {
          inversionAttempts: "dontInvert",
        });
        URL.revokeObjectURL(url);
        if (code && code.data) resolve(code.data);
        else reject(new Error("No QR code found in that image"));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e as Error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image"));
    };
    img.src = url;
  });
}
