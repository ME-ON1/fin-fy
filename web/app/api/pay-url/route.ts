import { NextResponse } from "next/server";
import { createSign } from "crypto";

// Runs in Node (not edge) so the RSA key stays on the server.
export const runtime = "nodejs";

interface PayBody {
  pa?: string | null;
  pn?: string | null;
  am?: string | number | null;
  cu?: string | null;
  note?: string | null;
}

// Google Pay intent extras. Keep these out of the browser too.
const AID = "uGICAgIC1lKfVLQ";
const MC = "";
const TR = "b76ec8450672";

export async function POST(req: Request) {
  let body: PayBody;
  try {
    body = (await req.json()) as PayBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pa = (body.pa ?? "").trim();
  if (!pa) {
    return NextResponse.json({ error: "Missing payee (pa)" }, { status: 400 });
  }

  const p = new URLSearchParams();
  p.set("pa", pa);
  if (body.pn) p.set("pn", body.pn);
  if (body.am) p.set("am", String(body.am));
  p.set("cu", body.cu || "INR");
  if (body.note) p.set("tn", body.note);
  p.set("aid", AID);
  if (MC) p.set("mc", MC);
  if (TR) p.set("tr", TR);

  // URLSearchParams encodes spaces as "+"; UPI intents want "%20".
  const uri = "gpay://pay?" + p.toString().replace(/\+/g, "%20");

  // The private key is server-only (never NEXT_PUBLIC_*). If it's absent or
  // invalid, fall back to an unsigned intent instead of crashing the request.
  const privateKey = process.env.RSA_PRIVATE_KEY;
  if (!privateKey) return NextResponse.json({ url: uri, signed: false });

  try {
    const sign = createSign("RSA-SHA256");
    sign.update(uri);
    sign.end();
    return NextResponse.json({
      url: uri + "&sign=" + sign.sign(privateKey, "base64"),
      signed: true,
    });
  } catch {
    return NextResponse.json({ url: uri, signed: false });
  }
}
