# fin-fy · web (Next.js frontend)

React/Next.js (App Router, TypeScript) port of the original vanilla-JS
frontend (`../app/static/`). The FastAPI backend is unchanged.

## Run

```bash
cd web
npm install
npm run dev            # http://localhost:3000
```

The dev server proxies every `/api/*` request to the FastAPI backend at
`http://127.0.0.1:8000` (see `next.config.mjs`). Point it elsewhere with:

```bash
API_TARGET=http://192.168.1.20:8000 npm run dev
```

Production:

```bash
npm run build
npm run start          # needs API_TARGET reachable
```

Start the backend as usual from the repo root:

```bash
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## What was ported

| Original (`app/static/`) | Now (`web/`) |
| --- | --- |
| `fp.js` (canvas/WebGL SHA-256 fingerprint) | `lib/device.ts` |
| `app.js` — API + state | `lib/store.tsx` (React context provider) |
| `app.js` — formatting | `lib/format.ts` |
| `app.js` — QR/pay helpers | `lib/upi.ts` |
| `index.html` + `app.js` DOM code | `components/*` + `app/page.tsx` |
| `app.css` | `app/globals.css` |
| `vendor/jsqr.js` (global) | `jsqr` npm dependency |

Views: **Ledger**, **By UPI**, **Split**, **Pay** (QR scan + Google Pay
deep-link), **People**, plus the register and upload-preview modals and toasts.

## Notes

- **Same-origin API.** Requests still carry `X-Device-Id` / `X-Device-Fp`
  headers; the `device_not_recognized` 403 path reopens the register modal
  just like before.
- **Client-only identity.** Device id / fingerprint / payment state live in
  `localStorage` / `sessionStorage`, so the app renders as client components.
- **QR parsing fix.** The original `parseUpiQr()` called Node's `require("crypto")`
  in browser code, which threw — so scanning was broken. The port drops that
  unused snippet and reads the UPI params directly. `buildTezUrl()` output is
  otherwise byte-for-byte the same.
