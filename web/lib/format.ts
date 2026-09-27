/** Format whole rupees without trailing `.00`; show paise only when present. */
export function fmtMoney(n: number | string): string {
  const num = Number(n);
  const hasPaise = Math.round(num * 100) % 100 !== 0;
  return (
    "₹" +
    num.toLocaleString("en-IN", { maximumFractionDigits: hasPaise ? 2 : 0 })
  );
}

/** e.g. "Sat, 5 Apr" */
export function fmtDay(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
