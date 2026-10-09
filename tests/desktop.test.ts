import { beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  createManualTransaction,
  createManualTransfer,
  createNativeBackup,
  deleteRegisterEntry,
  loadAccountRegister,
  loadBalanceOverTime,
  loadBudgetInfo,
  loadForecast,
  loadIncomeBreakdown,
  loadIncomeVsExpense,
  loadInflowOutflowByMonth,
  loadOutflowOverTime,
  loadPlanMonth,
  loadSpendingByPayee,
  movePlanMoney,
  loadWorkspace,
  previewAccountReconciliation,
  reconcileAccount,
  setPlanAssignment,
  setCreditPaymentCategory,
  setCategoryTarget,
  setCategoryTargetSnoozed,
  updateRegisterEntry,
  loadUndoStatus,
  undoLastAction,
  subscribeSavedMutations,
  releaseUndoReservation,
  getSavedMutationVersion,
} from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it("does not access desktop storage in browser preview", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  expect(await loadBudgetInfo()).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps undo unavailable in browser preview", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  expect(await loadUndoStatus()).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("loads and runs undo through the typed desktop commands", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue({ canUndo: true, label: "Edit transaction" });
  const signals: Array<{ pending: boolean; version: number }> = [];
  const unsubscribe = subscribeSavedMutations((pending, version) => signals.push({ pending, version }));
  const versionBeforeUndo = getSavedMutationVersion();
  await expect(loadUndoStatus()).resolves.toEqual({ canUndo: true, label: "Edit transaction" });
  expect(invoke).toHaveBeenCalledWith("get_undo_status");
  await undoLastAction();
  expect(invoke).toHaveBeenLastCalledWith("undo_last_action");
  expect(signals.at(-1)?.pending).toBe(true);
  expect(getSavedMutationVersion()).toBeGreaterThan(versionBeforeUndo);
  releaseUndoReservation();
  expect(signals.at(-1)?.pending).toBe(false);
  unsubscribe();
});

it("signals saved mutations from start through completion", async () => {
  let resolveMutation!: (value: string) => void;
  vi.mocked(invoke).mockReturnValue(new Promise((resolve) => { resolveMutation = resolve; }));
  const signals: boolean[] = [];
  const unsubscribe = subscribeSavedMutations((pending) => signals.push(pending));
  const write = createManualTransaction({} as never);
  expect(signals).toEqual([false, true]);
  resolveMutation("transaction");
  await write;
  expect(signals).toEqual([false, true, false]);
  unsubscribe();
});

it("refuses undo during a saved write and blocks new writes until undo refresh releases its reservation", async () => {
  let writeResolve!: (value: string) => void;
  let undoResolve!: (status: { canUndo: boolean; label: string | null }) => void;
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === "create_manual_transaction") return new Promise((resolve) => { writeResolve = resolve; });
    if (command === "undo_last_action") return new Promise((resolve) => { undoResolve = resolve; });
    return Promise.resolve({ canUndo: false, label: null });
  });
  const pendingWrite = createManualTransaction({} as never);
  await expect(undoLastAction()).rejects.toThrow("still in progress");
  writeResolve("transaction");
  await pendingWrite;
  const pendingUndo = undoLastAction();
  await expect(createManualTransaction({} as never)).rejects.toThrow("refreshing the budget");
  undoResolve({ canUndo: false, label: null });
  await pendingUndo;
  releaseUndoReservation();
  vi.mocked(invoke).mockResolvedValue("transaction");
  await expect(createManualTransaction({} as never)).resolves.toBe("transaction");
});

it("loads the actual budget through the desktop command", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const budget = { name: "Test budget", currency: "HUF", schemaVersion: 1, databasePath: "test.sqlite3" };
  vi.mocked(invoke).mockResolvedValue(budget);
  expect(await loadBudgetInfo()).toEqual(budget);
  expect(invoke).toHaveBeenCalledWith("get_budget_info");
});

it("propagates storage failure instead of falling back to a fake budget", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockRejectedValue(new Error("Database unavailable"));
  await expect(loadBudgetInfo()).rejects.toThrow("Database unavailable");
});

it("creates a verified native backup through the desktop command", async () => {
  vi.mocked(invoke).mockResolvedValue({ path: "backups/allocash-manual.sqlite3", schemaVersion: 8 });
  await expect(createNativeBackup()).resolves.toEqual({ path: "backups/allocash-manual.sqlite3", schemaVersion: 8 });
  expect(invoke).toHaveBeenCalledWith("create_native_backup");
});

it("loads account balances for an explicit local calendar date", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const workspace = {
    budget: { name: "Test budget", currency: "HUF", schemaVersion: 2, databasePath: "test.sqlite3" },
    accounts: [],
  };
  vi.mocked(invoke).mockResolvedValue(workspace);
  expect(await loadWorkspace("2026-09-14")).toEqual(workspace);
  expect(invoke).toHaveBeenCalledWith("get_workspace", { asOf: "2026-09-14" });
});

it("loads the selected account register without numeric money conversion", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const entries = [{ id: "t", amount: "9223372036854775807" }];
  vi.mocked(invoke).mockResolvedValue(entries);
  expect(await loadAccountRegister("cash")).toEqual(entries);
  expect(invoke).toHaveBeenCalledWith("get_account_register", { accountId: "cash" });
});

it("keeps workspace and register reads out of the browser preview", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  expect(await loadWorkspace("2026-09-14")).toBeNull();
  expect(await loadAccountRegister("cash")).toBeNull();
  expect(await loadPlanMonth("2026-09")).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("loads and updates a plan month with canonical HUF text", async () => {
  vi.mocked(isTauri).mockReturnValue(true); vi.mocked(invoke).mockResolvedValue({ month: "2026-09", readyToAssign: "0", categories: [] });
  await loadPlanMonth("2026-09", "2026-09-14"); expect(invoke).toHaveBeenCalledWith("get_plan_month", { month: "2026-09", asOf: "2026-09-14" });
  await setPlanAssignment("groceries", "2026-09", "12500"); expect(invoke).toHaveBeenCalledWith("set_plan_assignment", { input: { categoryId: "groceries", month: "2026-09", amount: "12500" } });
  await movePlanMoney("groceries", "fun", "2026-09", "500", "2026-09-14"); expect(invoke).toHaveBeenCalledWith("move_plan_money", { input: { fromCategoryId: "groceries", toCategoryId: "fun", month: "2026-09", amount: "500", asOf: "2026-09-14" } });
  await setCreditPaymentCategory("card", "card-payment"); expect(invoke).toHaveBeenCalledWith("set_credit_payment_category", { input: { accountId: "card", categoryId: "card-payment" } });
  await setCategoryTarget("groceries", "2026-09", { behavior: "refill", amount: "20000", dueKind: "last_day", dueDay: null }); expect(invoke).toHaveBeenCalledWith("set_category_target", { input: { categoryId: "groceries", effectiveMonth: "2026-09", target: { behavior: "refill", amount: "20000", dueKind: "last_day", dueDay: null } } });
  await setCategoryTargetSnoozed("groceries", "2026-09", true); expect(invoke).toHaveBeenCalledWith("set_category_target_snoozed", { input: { categoryId: "groceries", month: "2026-09", snoozed: true } });
});

it("loads spending by payee with the selected report scope", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const input = { from: "2026-09-01", to: "2026-09-14", accountIds: ["cash"] };
  const report = [{ payeeName: "Market", total: "1200", transactionCount: 2 }];
  vi.mocked(invoke).mockResolvedValue(report);
  await expect(loadSpendingByPayee(input)).resolves.toEqual(report);
  expect(invoke).toHaveBeenCalledWith("get_spending_by_payee", { input });
});

it.each([3, 12] as const)("sends an explicit recurring target due month with a %i-month interval", async (intervalMonths) => {
  const target = { behavior: "refill" as const, amount: "120000", dueKind: "day" as const, dueDay: 1, intervalMonths, firstDueMonth: "2027-09" };
  await setCategoryTarget("annual-fee", "2026-10", target);
  expect(invoke).toHaveBeenCalledWith("set_category_target", { input: { categoryId: "annual-fee", effectiveMonth: "2026-10", target } });
});

it("loads monthly inflow and outflow with the selected report scope", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const input = { from: "2026-09-01", to: "2026-09-14", accountIds: ["cash"] };
  const report = { from: input.from, to: input.to, months: [], totalInflow: "0", totalOutflow: "0", totalDifference: "0" };
  vi.mocked(invoke).mockResolvedValue(report);
  await expect(loadInflowOutflowByMonth(input)).resolves.toEqual(report);
  expect(invoke).toHaveBeenCalledWith("get_inflow_outflow_by_month", { input });
});

it("loads income versus expense with the selected report scope", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const input = { from: "2026-09-01", to: "2026-09-14", accountIds: ["cash"] };
  const report = { from: input.from, to: input.to, months: [], incomeGroups: [], expenseGroups: [], monthlyTotals: [], totalIncome: "0", totalExpense: "0", totalNetIncome: "0", averageMonthlyIncome: "0", averageMonthlyExpense: "0", averageMonthlyNetIncome: "0", savingsRatioBasisPoints: null };
  vi.mocked(invoke).mockResolvedValue(report);
  await expect(loadIncomeVsExpense(input)).resolves.toEqual(report);
  expect(invoke).toHaveBeenCalledWith("get_income_vs_expense", { input });
});

it("loads balance history with its selected-account scope", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const input = { from: "2026-09-01", to: "2026-09-14", accountIds: ["cash"] };
  const report = { from: input.from, to: input.to, pointDates: [input.from, input.to], totalBalances: ["0", "1200"], accounts: [] };
  vi.mocked(invoke).mockResolvedValue(report);
  await expect(loadBalanceOverTime(input)).resolves.toEqual(report);
  expect(invoke).toHaveBeenCalledWith("get_balance_over_time", { input });
});

it("loads outflow history with account and category scope", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const input = { from: "2026-09-01", to: "2026-09-14", accountIds: ["cash"], categoryIds: ["groceries", null] };
  const report = { from: input.from, to: input.to, months: [], monthlyTotals: [], categories: [], totalOutflow: "0", averageMonthlyOutflow: "0", transactionCount: 0 };
  vi.mocked(invoke).mockResolvedValue(report);
  await expect(loadOutflowOverTime(input)).resolves.toEqual(report);
  expect(invoke).toHaveBeenCalledWith("get_outflow_over_time", { input });
});

it("loads income breakdown with the selected activity scope", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const input = { from: "2026-09-01", to: "2026-09-14", accountIds: ["cash"] };
  const report = { from: input.from, to: input.to, incomeSources: [], expenseGroups: [], totalIncome: "0", totalExpense: "0", netIncome: "0" };
  vi.mocked(invoke).mockResolvedValue(report);
  await expect(loadIncomeBreakdown(input)).resolves.toEqual(report);
  expect(invoke).toHaveBeenCalledWith("get_income_breakdown", { input });
});

it("loads a deterministic forecast with its selected scope", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const input = { asOf: "2026-09-14", horizonMonths: 12, historyMonths: 12, accountIds: ["cash"], categoryIds: [null], seed: "42" };
  const report = { asOf: input.asOf, through: "2027-09-30", historyFrom: "2025-09-01", historyTo: "2026-08-31", seed: input.seed, simulationCount: 2000, startingBalance: "0", pointDates: [], percentilePaths: [], assumptions: [] };
  vi.mocked(invoke).mockResolvedValue(report);
  await expect(loadForecast(input)).resolves.toEqual(report);
  expect(invoke).toHaveBeenCalledWith("get_forecast", { input });
});

it("sends typed reconciliation review and completion inputs", async () => {
  const input = { accountId: "cash", asOf: "2026-09-14", bankClearedBalance: "12500", expectedClearedBalance: null };
  const review = { ...input, appClearedBalance: "12000", adjustmentAmount: "500", clearedEntryCount: 3 };
  vi.mocked(invoke).mockResolvedValue(review);
  await expect(previewAccountReconciliation(input)).resolves.toEqual(review);
  expect(invoke).toHaveBeenCalledWith("preview_account_reconciliation", { input });
  const completion = { ...input, expectedClearedBalance: "12000" };
  await reconcileAccount(completion);
  expect(invoke).toHaveBeenCalledWith("reconcile_account", { input: completion });
});

it("sends typed manual transaction and transfer inputs", async () => {
  vi.mocked(invoke).mockResolvedValue("created-id");
  const transaction = {
    accountId: "cash",
    date: "2026-09-14",
    payeeName: "Market",
    categoryId: "groceries",
    memo: "Food",
    flagId: null,
    amount: "-2500",
  };
  const transfer = {
    accountId: "cash",
    counterpartAccountId: "card",
    date: "2026-09-14",
    memo: "Payment",
    flagId: null,
    amount: "1000",
    direction: "outflow" as const,
  };
  await expect(createManualTransaction(transaction)).resolves.toBe("created-id");
  expect(invoke).toHaveBeenCalledWith("create_manual_transaction", { input: transaction });
  await expect(createManualTransfer(transfer)).resolves.toBe("created-id");
  expect(invoke).toHaveBeenCalledWith("create_manual_transfer", { input: transfer });
});

it("sends atomic register edits and confirmed deletions", async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  const edit = {
    id: "transaction",
    accountId: "cash",
    date: "2026-09-10",
    payeeName: "Market",
    categoryId: "groceries",
    memo: "Updated",
    flagId: null,
    amount: "-5000",
    clearedState: "reconciled" as const,
    confirmed: true,
  };
  await updateRegisterEntry(edit);
  expect(invoke).toHaveBeenCalledWith("update_register_entry", { edit });
  await deleteRegisterEntry("transaction", true);
  expect(invoke).toHaveBeenCalledWith("delete_register_entry", {
    id: "transaction",
    confirmed: true,
  });
});

it.each([0, 1, 3, 12] as const)("sends scheduled register edits with exact HUF text and %i-month recurrence metadata", async (repeatIntervalMonths) => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  const edit = {
    id: "scheduled-entry",
    accountId: "cash",
    date: "2026-10-10",
    payeeName: "Rent",
    categoryId: "rent",
    memo: "Updated schedule",
    flagId: "orange",
    amount: "-9223372036854775807",
    clearedState: "uncleared" as const,
    confirmed: false,
    repeatIntervalMonths,
  };
  await updateRegisterEntry(edit);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("update_register_entry", { edit });
});
