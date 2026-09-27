/**
 * Device identity for fin-fy — a dependency-free port of the browser's
 * `fp.js`. Collects device signals (canvas render, WebGL GPU string, UA,
 * locale, timezone, screen, platform…) and hashes them with a pure-JS
 * SHA-256, so it works on plain HTTP over the LAN (where `crypto.subtle`
 * and `crypto.randomUUID` don't exist).
 */
import { DEVICE_KEY, FP_KEY } from "./constants";

/* ------------------------------------------------------------------ */
/* compact SHA-256 (ASCII input)                                       */
/* ------------------------------------------------------------------ */

/* eslint-disable no-var */
function sha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i: number, j: number;
  let result = "";
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;

  const fn = sha256 as unknown as { h?: number[]; k?: number[] };
  let hash = (fn.h = fn.h || []);
  const k = (fn.k = fn.k || []);
  let primeCounter = k.length;
  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += "\x80";
  while (ascii.length % 64 - 56) ascii += "\x00";
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return ""; // ASCII only
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    let cur = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = cur[0];
      const e = cur[4];
      const temp1 =
        cur[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & cur[5]) ^ (~e & cur[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & cur[1]) ^ (a & cur[2]) ^ (cur[1] & cur[2]));
      cur = [(temp1 + temp2) | 0].concat(cur);
      cur[4] = (cur[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      cur[i] = (cur[i] + oldHash[i]) | 0;
    }
    hash = cur;
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? 0 : "") + b.toString(16);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* signals                                                            */
/* ------------------------------------------------------------------ */

function canvasFp(): string {
  try {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 60;
    const ctx = c.getContext("2d");
    if (!ctx) return "canvas:unavailable";
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(100, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("fin-fy 1234567890", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("abcdefghijklmnopqrstuvwxyz", 4, 40);
    return sha256(c.toDataURL());
  } catch {
    return "canvas:unavailable";
  }
}

function webglFp(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") ||
      c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "webgl:unavailable";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const vendor = ext
      ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(gl.VENDOR);
    return String(vendor || "") + "|" + String(renderer || "");
  } catch {
    return "webgl:unavailable";
  }
}

export interface Fingerprint {
  hash: string;
  components: [string, string][];
}

export function computeFingerprint(): Fingerprint | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const nav = navigator;
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* ignore */
  }
  const components: [string, string][] = [
    ["canvas", canvasFp()],
    ["webgl", webglFp()],
    ["ua", nav.userAgent],
    ["lang", nav.language || ""],
    ["langs", (nav.languages || []).join(",")],
    ["tz", tz],
    ["dpr", String(window.devicePixelRatio || 1)],
    ["cores", String(nav.hardwareConcurrency || "?")],
    ["platform", nav.platform || ""],
  ];
  const raw = components.map((c) => c[0] + "=" + c[1]).join("|");
  return { hash: sha256(raw), components };
}

/**
 * The fingerprint is stable per device — cache it so browser-update drift
 * doesn't lock anyone out; recompute only when missing or forced.
 */
export function getCachedFingerprint(force = false): string | null {
  if (typeof window === "undefined") return null;
  let fp = force ? null : localStorage.getItem(FP_KEY);
  if (!fp) {
    try {
      fp = computeFingerprint()?.hash ?? null;
    } catch {
      return null;
    }
    if (fp) localStorage.setItem(FP_KEY, fp);
  }
  return fp;
}

/** Device id, created once and stored in localStorage. */
export function makeDeviceId(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") {
      return c.randomUUID().replace(/-/g, "").slice(0, 24);
    }
  } catch {
    /* fall through */
  }
  return "dev-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 18);
}

export function loadDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(DEVICE_KEY) || null;
}

export function storeDeviceId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEVICE_KEY, id);
}
