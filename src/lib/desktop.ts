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
  transferId: string | null;
  transferAccountName: string | null;
}

export interface PayeeOption {
  id: string;
  name: string;
  lastCategoryId: string | null;
  lastDirection: "outflow" | "inflow" | null;
}

export interface CategoryOption {
  id: string;
  groupName: string;
  name: string;
}

export interface FlagOption {
  id: string;
  name: string;
  color: string;
}

export interface TransactionFormOptions {
  payees: PayeeOption[];
  categories: CategoryOption[];
  flags: FlagOption[];
}

export interface WorkspaceSnapshot {
  budget: BudgetInfo;
  accounts: AccountOverview[];
  transactionOptions: TransactionFormOptions;
}

export interface ManualTransactionInput {
  accountId: string;
  date: string;
  payeeName: string | null;
  categoryId: string | null;
  memo: string;
  flagId: string | null;
  amount: string;
}

export interface ManualTransferInput {
  accountId: string;
  counterpartAccountId: string;
  date: string;
  memo: string;
  flagId: string | null;
  amount: string;
  direction: "outflow" | "inflow";
}
export interface MonthlyScheduleInput { accountId: string; startDate: string; endDate: string | null; payeeName: string | null; categoryId: string | null; memo: string; flagId: string | null; amount: string; }
export interface SpendingReportInput { from: string; to: string; accountIds: string[]; }
export interface SpendingCategoryTotal { categoryId: string | null; groupName: string | null; categoryName: string; total: string; transactionCount: number; }
export interface NetWorthReport { asOf: string; comparedTo: string | null; assets: string; debts: string; netWorth: string; change: string | null; }
export interface ScheduledOccurrence { scheduleId: string; transactionId: string; accountName: string; date: string; payeeName: string | null; categoryName: string | null; memo: string; amount: string; }

export interface RegisterEntryEdit {
  id: string;
  memo: string;
  amount: string;
  clearedState: ClearedState;
  confirmed: boolean;
}

export interface ReconciliationInput {
  accountId: string;
  asOf: string;
  bankClearedBalance: string;
  expectedClearedBalance: string | null;
}
export interface ReconciliationReview {
  accountId: string; asOf: string; appClearedBalance: string; bankClearedBalance: string;
  adjustmentAmount: string; clearedEntryCount: number;
}
export interface ReconciliationResult {
  review: ReconciliationReview; reconciledEntryCount: number; adjustmentTransactionId: string | null;
}
export interface CategoryTargetDefinition { behavior: "set_aside" | "refill"; amount: string; dueKind: "day" | "last_day"; dueDay: number | null; }
export interface CategoryTargetProgress extends CategoryTargetDefinition { neededThisMonth: string; funded: string; toGo: string; snoozed: boolean; }
export interface PlanCategory { groupId: string; groupName: string; categoryId: string; categoryName: string; assigned: string; activity: string; available: string; target: CategoryTargetProgress | null; }
export interface CreditPaymentCategory { accountId: string; accountName: string; categoryId: string | null; }
export interface PlanSnapshot { month: string; readyToAssign: string; categories: PlanCategory[]; creditPaymentCategories: CreditPaymentCategory[]; }

export const RECONCILED_CONFIRMATION_REQUIRED = "reconciled_confirmation_required";
export const RECONCILIATION_OUT_OF_DATE = "reconciliation_out_of_date";

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

export async function createManualTransaction(input: ManualTransactionInput): Promise<string> {
  return invoke<string>("create_manual_transaction", { input });
}

export async function createManualTransfer(input: ManualTransferInput): Promise<string> {
  return invoke<string>("create_manual_transfer", { input });
}
export async function loadScheduledOccurrences(): Promise<ScheduledOccurrence[] | null> { if (!isTauri()) return null; return invoke("get_scheduled_occurrences"); }
export async function createMonthlySchedule(input: MonthlyScheduleInput): Promise<void> { return invoke("create_monthly_schedule", { input }); }
export async function postScheduledOccurrence(transactionId: string): Promise<void> { return invoke("post_scheduled_occurrence", { transactionId }); }
export async function skipScheduledOccurrence(transactionId: string): Promise<void> { return invoke("skip_scheduled_occurrence", { transactionId }); }
export async function deactivateSchedule(scheduleId: string): Promise<void> { return invoke("deactivate_schedule", { scheduleId }); }
export async function loadSpendingByCategory(input: SpendingReportInput): Promise<SpendingCategoryTotal[] | null> { if (!isTauri()) return null; return invoke("get_spending_by_category", { input }); }
export async function loadNetWorthReport(asOf: string, comparedTo: string | null): Promise<NetWorthReport | null> { if (!isTauri()) return null; return invoke("get_net_worth_report", { asOf, comparedTo }); }

export async function updateRegisterEntry(edit: RegisterEntryEdit): Promise<void> {
  return invoke("update_register_entry", { edit });
}

export async function deleteRegisterEntry(id: string, confirmed: boolean): Promise<void> {
  return invoke("delete_register_entry", { id, confirmed });
}

export async function previewAccountReconciliation(input: ReconciliationInput): Promise<ReconciliationReview> {
  return invoke<ReconciliationReview>("preview_account_reconciliation", { input });
}
export async function reconcileAccount(input: ReconciliationInput): Promise<ReconciliationResult> {
  return invoke<ReconciliationResult>("reconcile_account", { input });
}
export async function loadPlanMonth(month: string): Promise<PlanSnapshot | null> { if (!isTauri()) return null; return invoke<PlanSnapshot>("get_plan_month", { month }); }
export async function setPlanAssignment(categoryId: string, month: string, amount: string): Promise<void> { return invoke("set_plan_assignment", { input: { categoryId, month, amount } }); }
export async function movePlanMoney(fromCategoryId: string, toCategoryId: string, month: string, amount: string): Promise<void> { return invoke("move_plan_money", { input: { fromCategoryId, toCategoryId, month, amount } }); }
export async function setCreditPaymentCategory(accountId: string, categoryId: string | null): Promise<void> { return invoke("set_credit_payment_category", { input: { accountId, categoryId } }); }
export async function setCategoryTarget(categoryId: string, effectiveMonth: string, target: CategoryTargetDefinition | null): Promise<void> { return invoke("set_category_target", { input: { categoryId, effectiveMonth, target } }); }
export async function setCategoryTargetSnoozed(categoryId: string, month: string, snoozed: boolean): Promise<void> { return invoke("set_category_target_snoozed", { input: { categoryId, month, snoozed } }); }
