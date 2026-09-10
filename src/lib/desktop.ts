import { invoke, isTauri } from "@tauri-apps/api/core";

export interface BudgetInfo {
  name: string;
  currency: "HUF";
  schemaVersion: number;
  databasePath: string;
}

export async function loadBudgetInfo(): Promise<BudgetInfo | null> {
  // Browser preview must never pretend that a budget was opened or saved.
  if (!isTauri()) return null;
  return invoke<BudgetInfo>("get_budget_info");
}
