export type Category =
  | "groceries"
  | "transport"
  | "food"
  | "shopping"
  | "utilities"
  | "health"
  | "entertainment"
  | "income"
  | "transfer"
  | "other";

export type TxType = "debit" | "credit";
export type TxStatus = "success" | "pending" | "failed";

export interface Member {
  id: string;
  name: string;
  upi_id: string | null;
  phone_model: string | null;
  device_id: string | null;
}

export interface LedgerRow {
  id: string;
  date: string;
  description: string;
  remarks: string | null;
  category: Category;
  counterparty: string | null;
  counterparty_upi: string | null;
  amount: number;
  type: TxType;
  is_shared: boolean;
  status: TxStatus;
  member_name: string;
  shared_with_name: string | null;
  account_name: string | null;
}

export interface LedgerSummary {
  month: string;
  total_spent: number;
  total_received: number;
  net: number;
  shared_spent: number;
  transactions: number;
  by_category: Record<string, number>;
  pending_count: number;
}

export interface LedgerResponse {
  summary: LedgerSummary;
  rows: LedgerRow[];
}

export interface UpiBucket {
  counterparty_upi: string | null;
  counterparty: string | null;
  count: number;
  total: number;
  shared_total: number;
  transactions: LedgerRow[];
}

export interface UpiSummaryResponse {
  month: string;
  total_spent: number;
  buckets: UpiBucket[];
}

export interface SplitTx {
  id: string;
  date: string;
  description: string;
  amount: number;
  payer: string;
  other: string | null;
  each_pays: number | null;
}

export interface Settlement {
  owes: string;
  to: string;
  amount: number;
}

export interface SplitResponse {
  month: string;
  shared_count: number;
  shared_total: number;
  unsettled_count: number;
  transactions: SplitTx[];
  settlements: Settlement[];
}

export interface PersonSummary {
  id: string;
  name: string;
  phone_model: string | null;
  total_paid: number;
  shared_paid: number;
}

export interface MembersSummaryResponse {
  members: PersonSummary[];
  shared_pairs: Record<string, number>;
}

export interface ParsedAccount {
  name: string | null;
  upi_id: string | null;
}

export interface ParsedTx {
  date: string;
  description: string;
  remarks: string | null;
  amount: number;
  type: TxType;
  category: Category;
  counterparty: string | null;
  counterparty_upi: string | null;
  upi_ref: string | null;
  is_shared: boolean;
  shared_hint: string | null;
}

/** A parsed row plus the partner chosen in the review screen. */
export interface EditableParsedTx extends ParsedTx {
  shared_with_id?: string | null;
}

export interface UploadPreview {
  account: ParsedAccount | null;
  transactions: EditableParsedTx[];
  skipped: number;
  warnings: string[];
  source_file: string;
}

export interface BatchResult {
  created: number;
  account_id: string | null;
}
