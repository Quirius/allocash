import { invoke, isTauri } from "@tauri-apps/api/core";

export interface BudgetInfo {
  name: string;
  currency: "HUF";
  schemaVersion: number;
  databasePath: string;
}

export type AccountKind = "cash" | "credit" | "loan" | "tracking";
export type ClearedState = "uncleared" | "cleared" | "reconciled";
export type PostingState = "posted" | "scheduled";
export type TransactionOrigin = "manual" | "import" | "schedule";

export interface AccountBalance {
  working: string;
  cleared: string;
  uncleared: string;
  reconciled: string;
}

export interface AccountOverview {
  id: string;
  name: string;
  kind: AccountKind;
  sortOrder: number;
  closed: boolean;
  balance: AccountBalance;
}

export interface RegisterEntry {
  id: string;
  date: string;
  payeeName: string | null;
  categoryGroupName: string | null;
  categoryName: string | null;
  memo: string;
  flagName: string | null;
  flagColor: string | null;
  clearedState: ClearedState;
  postingState: PostingState;
  origin: TransactionOrigin;
  amount: string;
  transferAccountName: string | null;
}

export interface WorkspaceSnapshot {
  budget: BudgetInfo;
  accounts: AccountOverview[];
}

export async function loadBudgetInfo(): Promise<BudgetInfo | null> {
  // Browser preview must never pretend that a budget was opened or saved.
  if (!isTauri()) return null;
  return invoke<BudgetInfo>("get_budget_info");
}

export async function loadWorkspace(asOf: string): Promise<WorkspaceSnapshot | null> {
  if (!isTauri()) return null;
  return invoke<WorkspaceSnapshot>("get_workspace", { asOf });
}

export async function loadAccountRegister(accountId: string): Promise<RegisterEntry[] | null> {
  if (!isTauri()) return null;
  return invoke<RegisterEntry[]>("get_account_register", { accountId });
}
