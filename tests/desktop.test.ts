import { beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  createManualTransaction,
  createManualTransfer,
  deleteRegisterEntry,
  loadAccountRegister,
  loadBudgetInfo,
  loadInflowOutflowByMonth,
  loadPlanMonth,
  loadSpendingByPayee,
  movePlanMoney,
  loadWorkspace,
  setPlanAssignment,
  setCreditPaymentCategory,
  setCategoryTarget,
  setCategoryTargetSnoozed,
  updateRegisterEntry,
} from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it("does not access desktop storage in browser preview", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  expect(await loadBudgetInfo()).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
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
  await loadPlanMonth("2026-09"); expect(invoke).toHaveBeenCalledWith("get_plan_month", { month: "2026-09" });
  await setPlanAssignment("groceries", "2026-09", "12500"); expect(invoke).toHaveBeenCalledWith("set_plan_assignment", { input: { categoryId: "groceries", month: "2026-09", amount: "12500" } });
  await movePlanMoney("groceries", "fun", "2026-09", "500"); expect(invoke).toHaveBeenCalledWith("move_plan_money", { input: { fromCategoryId: "groceries", toCategoryId: "fun", month: "2026-09", amount: "500" } });
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

it("loads monthly inflow and outflow with the selected report scope", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const input = { from: "2026-09-01", to: "2026-09-14", accountIds: ["cash"] };
  const report = { from: input.from, to: input.to, months: [], totalInflow: "0", totalOutflow: "0", totalDifference: "0" };
  vi.mocked(invoke).mockResolvedValue(report);
  await expect(loadInflowOutflowByMonth(input)).resolves.toEqual(report);
  expect(invoke).toHaveBeenCalledWith("get_inflow_outflow_by_month", { input });
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
    memo: "Updated",
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
