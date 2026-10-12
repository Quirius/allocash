// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { App } from "../src/app/App";
import type { AllAccountsRegisterEntry, AccountOverview } from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
let allRegisterReads: number;
let failAllRefresh: boolean;
const accounts: AccountOverview[] = [
  { id: "cash", name: "Everyday", kind: "cash", sortOrder: 0, closed: false, balance: { working: "1000", cleared: "600", uncleared: "400", reconciled: "0" } },
  { id: "savings", name: "Savings", kind: "cash", sortOrder: 1, closed: false, balance: { working: "2500", cleared: "2000", uncleared: "500", reconciled: "0" } },
  { id: "closed", name: "Closed Card", kind: "credit", sortOrder: 2, closed: true, balance: { working: "-500", cleared: "-500", uncleared: "0", reconciled: "0" } },
];
const row = (id: string, accountId: string, accountName: string, overrides: Partial<AllAccountsRegisterEntry> = {}): AllAccountsRegisterEntry => ({
  accountId, accountName, id, date: "2026-10-09", payeeName: `Payee ${id}`, categoryId: null,
  categoryGroupName: null, categoryName: null, memo: `memo ${id}`, flagId: null,
  flagName: null, flagColor: null, clearedState: "uncleared", postingState: "posted",
  origin: "manual", amount: "1250", transferId: null, transferAccountName: null,
  ...overrides,
});
const closedRow = row("closed-txn", "closed", "Closed Card", { amount: "-9000" });
const transferFrom = row("transfer-a", "cash", "Everyday", { transferId: "xfer", transferAccountId: "savings", transferAccountName: "Savings", amount: "-3200" });
const transferTo = row("transfer-b", "savings", "Savings", { transferId: "xfer", transferAccountId: "cash", transferAccountName: "Everyday", amount: "3200" });
const allRows = [closedRow, transferFrom, transferTo, row("ordinary", "cash", "Everyday")];
const workspace = {
  budget: { name: "Test budget", currency: "HUF" as const, schemaVersion: 1, databasePath: "" },
  accounts,
  transactionOptions: { payees: [], categories: [], flags: [] },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12));
  allRows.splice(0, allRows.length, closedRow, transferFrom, transferTo, row("ordinary", "cash", "Everyday"));
  allRegisterReads = 0; failAllRefresh = false;
  vi.mocked(isTauri).mockReturnValue(true);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command) => {
    switch (String(command)) {
      case "realize_due_scheduled_transactions": return 0;
      case "get_workspace": return workspace;
      case "get_all_accounts_register":
        allRegisterReads += 1;
        if (failAllRefresh && allRegisterReads > 1) throw new Error("refresh failed");
        return allRows.map((item) => ({ ...item }));
      case "get_account_register": return [row("ordinary", "cash", "Everyday")];
      case "get_plan_month": return { month: "2026-10", readyToAssign: "0", categories: [], creditPaymentCategories: [] };
      case "get_undo_status": return { canUndo: false, label: null };
      case "list_native_backups": return { directory: "", names: [] };
      default: return undefined;
    }
  });
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function flush() { await act(async () => { for (let i = 0; i < 35; i += 1) await Promise.resolve(); }); }
async function mountAll() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<App />); for (let i = 0; i < 35; i += 1) await Promise.resolve(); });
  await act(async () => { host.querySelector<HTMLButtonElement>('button[title="Accounts"]')!.click(); for (let i = 0; i < 35; i += 1) await Promise.resolve(); });
}

it("loads the all-accounts register, includes closed and both transfer rows, and sums balances", async () => {
  await mountAll();
  expect(invoke).toHaveBeenCalledWith("get_all_accounts_register", {});
  expect(host.querySelector("h1")?.textContent).toBe("All Accounts");
  expect(host.querySelector(".balance-strip")?.textContent).toContain("3 000 Ft");
  expect(host.querySelector(".balance-strip")?.textContent).toContain("2 100 Ft");
  expect(host.querySelector(".balance-strip")?.textContent).toContain("900 Ft");
  expect(host.querySelectorAll(".register-table thead th")[1]?.textContent).toBe("Account");
  expect(host.querySelector('[data-entry-id="closed-txn"] .account-column')?.textContent).toBe("Closed Card");
  expect(host.querySelector('[data-entry-id="transfer-a"]')).not.toBeNull();
  expect(host.querySelector('[data-entry-id="transfer-b"]')).not.toBeNull();
  expect([...host.querySelectorAll(".register-toolbar button")].map((button) => button.textContent)).not.toContain("Reconcile");
  const allReadCount = vi.mocked(invoke).mock.calls.filter(([command]) => command === "get_all_accounts_register").length;
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-entry-id="ordinary"] [aria-label="Mark as cleared"]')!.click(); await flush(); });
  expect(host.querySelector("h1")?.textContent).toBe("All Accounts");
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "get_all_accounts_register").length).toBeGreaterThan(allReadCount);
});

it("requires choosing an open real account before composing from All Accounts", async () => {
  await mountAll();
  await act(async () => { [...host.querySelectorAll<HTMLButtonElement>(".register-toolbar button")].find((button) => button.textContent?.includes("Add transaction"))!.click(); });
  expect(host.querySelector("form.transaction-editor.transaction-inline")).toBeNull();
  const selector = host.querySelector<HTMLSelectElement>(".all-account-composer-choice select")!;
  expect([...selector.options].map((option) => option.value)).toEqual(["", "cash", "savings"]);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(selector, "savings"); selector.dispatchEvent(new Event("change", { bubbles: true })); await flush(); });
  await act(async () => { [...host.querySelectorAll<HTMLButtonElement>(".all-account-composer-choice button")].find((button) => button.textContent === "Continue")!.click(); });
  expect(host.querySelector("form.transaction-editor.transaction-inline")?.textContent).toContain("Account: Savings");
});

it("keeps the register mounted when a post-write read fails and retries only the read", async () => {
  await mountAll();
  const rowNode = host.querySelector('[data-entry-id="ordinary"]')!;
  failAllRefresh = true;
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-entry-id="ordinary"] [aria-label="Mark as cleared"]')!.click(); await flush(); });
  expect(host.querySelector('[data-entry-id="ordinary"]')).toBe(rowNode);
  expect(host.textContent).toContain("The saved data is not refreshed yet.");
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "set_register_entry_cleared_state")).toHaveLength(1);
  failAllRefresh = false;
  await act(async () => { [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Retry refresh")!.click(); await flush(); });
  expect(host.querySelector('[data-entry-id="ordinary"]')).toBe(rowNode);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "set_register_entry_cleared_state")).toHaveLength(1);
  expect(host.textContent).not.toContain("The saved data is not refreshed yet.");
});

it("searches all loaded rows before paging and matches the account column", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => row(`row-${index}`, index % 2 ? "cash" : "savings", index % 2 ? "Everyday" : "Savings", { date: "2026-01-01" }));
  rows[100] = row("needle-row", "closed", "Closed Card", { date: "2024-01-01", memo: "unusual memo" });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (String(command) === "get_all_accounts_register") return rows;
    if (String(command) === "realize_due_scheduled_transactions") return 0;
    if (String(command) === "get_workspace") return workspace;
    if (String(command) === "get_plan_month") return { month: "2026-10", readyToAssign: "0", categories: [], creditPaymentCategories: [] };
    if (String(command) === "get_undo_status") return { canUndo: false, label: null };
    if (String(command) === "list_native_backups") return { directory: "", names: [] };
    return undefined;
  });
  await mountAll();
  expect(host.querySelector('[data-entry-id="needle-row"]')).toBeNull();
  const search = host.querySelector<HTMLInputElement>('.all-register-search input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "closed card");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  expect(host.querySelector('[data-entry-id="needle-row"]')).not.toBeNull();
  expect(host.querySelectorAll("tbody tr[data-entry-id]")).toHaveLength(1);
});

it("edits a closed-account row using its real owner and focuses its Account control", async () => {
  await mountAll();
  const accountCell = host.querySelector('[data-entry-id="closed-txn"] [data-register-field="account"]')!;
  await act(async () => { accountCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await flush(); });
  const editor = host.querySelector<HTMLFormElement>('[data-entry-id="closed-txn"] form.transaction-inline')!;
  const accountSelect = editor.querySelector<HTMLSelectElement>('[data-register-editor-field="account"]')!;
  expect(accountSelect.value).toBe("closed");
  expect(document.activeElement).toBe(accountSelect);
});

it("keeps an inline draft mounted and disables search and paging until it is canceled", async () => {
  const rows = [...allRows, ...Array.from({ length: 105 }, (_, index) => row(`past-${index}`, "cash", "Everyday", { date: "2026-01-01" }))];
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (String(command) === "get_all_accounts_register") return rows.map((item) => ({ ...item }));
    if (String(command) === "realize_due_scheduled_transactions") return 0;
    if (String(command) === "get_workspace") return workspace;
    if (String(command) === "get_plan_month") return { month: "2026-10", readyToAssign: "0", categories: [], creditPaymentCategories: [] };
    if (String(command) === "get_undo_status") return { canUndo: false, label: null };
    if (String(command) === "list_native_backups") return { directory: "", names: [] };
    return undefined;
  });
  await mountAll();
  const search = host.querySelector<HTMLInputElement>(".all-register-search input")!;
  const rowNode = host.querySelector('[data-entry-id="ordinary"]')!;
  await act(async () => { rowNode.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await flush(); });
  const memoField = host.querySelector<HTMLInputElement>('[data-entry-id="ordinary"] [data-register-editor-field="memo"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(memoField, "unsaved draft"); memoField.dispatchEvent(new Event("input", { bubbles: true })); await Promise.resolve(); });
  expect(search.disabled).toBe(true);
  expect(memoField.value).toBe("unsaved draft");
  expect([...host.querySelectorAll<HTMLButtonElement>(".register-pagination button")].some((button) => !button.disabled)).toBe(false);
  await act(async () => { [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!.click(); });
  expect((host.querySelector(".all-register-search input") as HTMLInputElement).disabled).toBe(false);
});

it("keeps editing enabled when a refresh only changes a different row", async () => {
  await mountAll();
  const rowNode = host.querySelector('[data-entry-id="ordinary"]')!;
  await act(async () => { rowNode.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await flush(); });
  const editor = host.querySelector<HTMLFormElement>('[data-entry-id="ordinary"] form.transaction-inline')!;
  const memoField = editor.querySelector<HTMLInputElement>('[data-register-editor-field="memo"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(memoField, "private draft");
  await act(async () => { memoField.dispatchEvent(new Event("input", { bubbles: true })); await Promise.resolve(); });
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-entry-id="closed-txn"] [aria-label="Mark as cleared"]')!.click(); await flush(); });
  const currentEditor = host.querySelector<HTMLFormElement>('[data-entry-id="ordinary"] form.transaction-inline')!;
  expect(currentEditor.querySelector<HTMLInputElement>('[data-register-editor-field="memo"]')?.value).toBe("private draft");
  expect(currentEditor.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  expect(host.textContent).not.toContain("This transaction changed while you were editing.");
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "set_register_entry_cleared_state")).toHaveLength(1);
});

it("keeps an edited row read-only after a fresh snapshot changes it", async () => {
  await mountAll();
  const originalRow = host.querySelector('[data-entry-id="ordinary"]')!;
  await act(async () => { originalRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await flush(); });
  const editor = host.querySelector<HTMLFormElement>('[data-entry-id="ordinary"] form.transaction-inline')!;
  const memoField = editor.querySelector<HTMLInputElement>('[data-register-editor-field="memo"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(memoField, "private draft");
  await act(async () => { memoField.dispatchEvent(new Event("input", { bubbles: true })); await Promise.resolve(); });
  allRows[3] = { ...allRows[3]!, memo: "externally changed" };
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-entry-id="closed-txn"] [aria-label="Mark as cleared"]')!.click(); await flush(); });
  const currentEditor = host.querySelector<HTMLFormElement>('[data-entry-id="ordinary"] form.transaction-inline')!;
  expect(currentEditor.querySelector<HTMLInputElement>('[data-register-editor-field="memo"]')?.value).toBe("private draft");
  expect((currentEditor.querySelector<HTMLButtonElement>('button[type="submit"]')!).disabled).toBe(true);
  expect(host.textContent).toContain("This transaction changed while you were editing.");
  const cancel = [...currentEditor.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!;
  expect(cancel.disabled).toBe(false);
  await act(async () => { cancel.click(); });
  expect(host.querySelector('[data-entry-id="ordinary"] form.transaction-inline')).toBeNull();
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "update_register_entry")).toHaveLength(0);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "set_register_entry_cleared_state")).toHaveLength(1);
});

it("closes an editor when its transaction disappears from the refreshed snapshot", async () => {
  await mountAll();
  const rowNode = host.querySelector('[data-entry-id="ordinary"]')!;
  await act(async () => { rowNode.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await flush(); });
  allRows.splice(3, 1);
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-entry-id="closed-txn"] [aria-label="Mark as cleared"]')!.click(); await flush(); });
  expect(host.querySelector('[data-entry-id="ordinary"] form.transaction-inline')).toBeNull();
  expect(host.textContent).toContain("This transaction no longer exists.");
  expect((host.querySelector(".all-register-search input") as HTMLInputElement).disabled).toBe(false);
});

it("falls back to Payee when the clicked Account cell belongs to a paired transfer", async () => {
  await mountAll();
  const accountCell = host.querySelector('[data-entry-id="transfer-a"] [data-register-field="account"]')!;
  await act(async () => { accountCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await flush(); });
  const editor = host.querySelector<HTMLFormElement>('[data-entry-id="transfer-a"] form.transaction-inline')!;
  expect((editor.querySelector('[data-register-editor-field="account"]') as HTMLSelectElement).disabled).toBe(true);
  expect(document.activeElement).toBe(editor.querySelector('[data-register-editor-field="payee"]'));
});

it("keeps an upcoming Make Repeating draft writable against the original row", async () => {
  allRows.push(row("future-repeat", "cash", "Everyday", { date: "2026-11-15", repeatIntervalMonths: 0 }));
  await mountAll();
  await act(async () => { host.querySelector('[data-entry-id="future-repeat"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 })); });
  const repeating = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.includes("Make Repeating"))!;
  await act(async () => { repeating.click(); await flush(); });
  const form = host.querySelector<HTMLFormElement>('[data-entry-id="future-repeat"] form.transaction-inline')!;
  expect(form).not.toBeNull();
  expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  expect(host.textContent).not.toContain("This transaction changed while you were editing");
  await act(async () => { form.querySelector<HTMLButtonElement>('.date-picker-trigger')!.click(); await flush(); });
  expect(document.querySelector<HTMLSelectElement>('.calendar-repeat select')!.value).toBe("monthly");
});

it("creates duplicate drafts from the actual source account and keeps All Accounts until a sidebar account is chosen", async () => {
  await mountAll();
  const rowNode = host.querySelector('[data-entry-id="closed-txn"]')!;
  await act(async () => { rowNode.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 })); });
  const duplicate = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.includes("Duplicate"))!;
  await act(async () => { duplicate.click(); await flush(); });
  const composer = host.querySelector<HTMLFormElement>("form.transaction-editor.transaction-inline")!;
  expect(composer.textContent).toContain("Account: Closed Card");
  expect(host.querySelector("h1")?.textContent).toBe("All Accounts");
  await act(async () => { [...host.querySelectorAll<HTMLButtonElement>(".account-link")].find((button) => button.textContent?.includes("Savings"))!.click(); await flush(); });
  expect(host.querySelector("h1")?.textContent).toBe("Savings");
  expect(invoke).toHaveBeenCalledWith("get_account_register", { accountId: "savings" });
});
