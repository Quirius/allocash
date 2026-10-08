import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createPayeeEntry, createScheduledPayeeEntry, scheduleForEntry } from "../src/lib/transaction";
import type { AccountOverview, ManualTransactionInput } from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(invoke).mockResolvedValue("entry-id"); });

const cash: AccountOverview = {
  id: "cash", name: "Cash", kind: "cash", closed: false, sortOrder: 0,
  balance: { working: "0", cleared: "0", uncleared: "0", reconciled: "0" },
};
const accounts = [cash, { ...cash, id: "bank", name: "Bank" }];
const draft: ManualTransactionInput = {
  accountId: "bank", date: "2026-10-05", payeeName: "Transfer: Cash",
  categoryId: "food", memo: "Test transfer", flagId: null, amount: "-1000",
};

it.each(["Transfer: Cash", " transfer: cash ", "Payment: Cash"])("creates a linked transfer for payee %s", async (payeeName) => {
  await expect(createPayeeEntry({ ...draft, payeeName }, accounts)).resolves.toBe("entry-id");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_manual_transfer", { input: {
    accountId: "bank", counterpartAccountId: "cash", date: "2026-10-05",
    memo: "Test transfer", flagId: null, amount: "1000", direction: "outflow",
  } });
});

it("creates the inflow side without losing integer precision", async () => {
  await createPayeeEntry({ ...draft, amount: "9007199254740993" }, accounts);
  expect(invoke).toHaveBeenCalledWith("create_manual_transfer", { input: expect.objectContaining({
    amount: "9007199254740993", direction: "inflow", counterpartAccountId: "cash",
  }) });
});

it.each(["Transfer:", "Transfer: Ca", "Transfer: Missing", "Transfer: Bank"])("rejects unresolved or same-account payee %s without writing", async (payeeName) => {
  await expect(createPayeeEntry({ ...draft, payeeName }, accounts)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("refuses closed or ambiguous destination accounts", async () => {
  await expect(createPayeeEntry(draft, [{ ...cash, closed: true }])).rejects.toThrow("closed");
  await expect(createPayeeEntry(draft, [cash, { ...cash, id: "duplicate" }])).rejects.toThrow("exact transfer account");
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps ordinary payees and their categories unchanged", async () => {
  const ordinary = { ...draft, payeeName: "Shop" };
  await createPayeeEntry(ordinary, accounts);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_manual_transaction", { input: ordinary });
});

it.each([3, 12] as const)("schedules a transfer payee every %i months through the linked-transfer schedule input", async (intervalMonths) => {
  await createScheduledPayeeEntry({ accountId: "bank", startDate: "2026-10-05", endDate: null, payeeName: "Transfer: Cash", categoryId: "loan", memo: "Recurring", flagId: null, amount: "-1000", intervalMonths }, accounts);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_monthly_schedule", { input: {
    accountId: "bank", startDate: "2026-10-05", endDate: null, payeeName: null,
    categoryId: "loan", memo: "Recurring", flagId: null, amount: "-1000",
    intervalMonths, counterpartAccountId: "cash",
  } });
});

it("rejects an unresolved transfer payee without creating an ordinary schedule", async () => {
  await expect(createScheduledPayeeEntry({ accountId: "bank", startDate: "2026-10-05", endDate: null, payeeName: "Transfer: Missing", categoryId: null, memo: "", flagId: null, amount: "1000", intervalMonths: 3 }, accounts)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("routes future Never dates to a one-occurrence scheduled entry", async () => {
  const schedule = scheduleForEntry("2026-10-06", "never", "2026-10-05");
  expect(schedule).toEqual({ intervalMonths: 1, endDate: "2026-10-06" });
  await createScheduledPayeeEntry({ accountId: "bank", startDate: "2026-10-06", endDate: schedule!.endDate, payeeName: "Shop", categoryId: "food", memo: "Future", flagId: null, amount: "-1200", intervalMonths: schedule!.intervalMonths }, accounts);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_monthly_schedule", { input: expect.objectContaining({ payeeName: "Shop", endDate: "2026-10-06", intervalMonths: 1, amount: "-1200", categoryId: "food" }) });
});

it.each(["2026-10-05", "2026-10-04"]) ("keeps current or past Never date %s manual", async (date) => {
  expect(scheduleForEntry(date, "never", "2026-10-05")).toBeNull();
  await createPayeeEntry({ ...draft, date, payeeName: "Shop" }, accounts);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_manual_transaction", { input: expect.objectContaining({ date, payeeName: "Shop" }) });
});

it("schedules an ordinary yearly entry", async () => {
  await createScheduledPayeeEntry({ accountId: "bank", startDate: "2026-10-05", endDate: null, payeeName: "Insurance", categoryId: "bills", memo: "Annual", flagId: null, amount: "-10000", intervalMonths: 12 }, accounts);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_monthly_schedule", { input: expect.objectContaining({ payeeName: "Insurance", intervalMonths: 12, categoryId: "bills" }) });
});

it("schedules a future one-off transfer as one linked occurrence", async () => {
  const schedule = scheduleForEntry("2026-10-06", "never", "2026-10-05");
  await createScheduledPayeeEntry({ accountId: "bank", counterpartAccountId: "cash", startDate: "2026-10-06", endDate: schedule!.endDate, payeeName: null, categoryId: "loan", memo: "Later", flagId: null, amount: "-4000", intervalMonths: schedule!.intervalMonths }, accounts);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_monthly_schedule", { input: expect.objectContaining({ counterpartAccountId: "cash", endDate: "2026-10-06", intervalMonths: 1, categoryId: "loan" }) });
});

it.each([["monthly", 1], ["quarterly", 3], ["yearly", 12]] as const)("maps %s recurrence to %i months", (repeat, intervalMonths) => {
  expect(scheduleForEntry("2026-10-05", repeat, "2026-10-05")).toEqual({ intervalMonths, endDate: null });
});

it("schedules an explicit transfer with its selected category", async () => {
  await createScheduledPayeeEntry({ accountId: "bank", counterpartAccountId: "cash", startDate: "2026-10-05", endDate: null, payeeName: null, categoryId: "loan", memo: "Recurring", flagId: "orange", amount: "-1000", intervalMonths: 12 }, accounts);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_monthly_schedule", { input: expect.objectContaining({ counterpartAccountId: "cash", categoryId: "loan", intervalMonths: 12, amount: "-1000", flagId: "orange" }) });
});

it("preserves a copied month-end anchor in the schedule IPC payload", async () => {
  await createScheduledPayeeEntry({ accountId: "bank", startDate: "2026-02-28", dayOfMonth: 31,
    endDate: null, payeeName: "Rent", categoryId: "bills", memo: "", flagId: null,
    amount: "-1000", intervalMonths: 1 }, accounts);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_monthly_schedule", { input: expect.objectContaining({
    startDate: "2026-02-28", dayOfMonth: 31, intervalMonths: 1,
  }) });
});
