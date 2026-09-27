import type { Category } from "./types";

export const CAT_LABELS: Record<Category, string> = {
  groceries: "🛒",
  transport: "🚕",
  food: "🍜",
  shopping: "🛍️",
  utilities: "💡",
  health: "💊",
  entertainment: "🎬",
  income: "💰",
  transfer: "🔁",
  other: "📄",
};

export const CATEGORIES = Object.keys(CAT_LABELS) as Category[];

export const NOTE_PRESETS: { label: string; note: string; both: boolean }[] = [
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

export const DEVICE_KEY = "finfy_device_id";
export const FP_KEY = "finfy_fp";
export const PAY_KEY = "finfy_pay";
