// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { App } from "../src/app/App";
import type { AccountOverview, RegisterEntry } from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined; let host: HTMLDivElement | undefined;
const account: AccountOverview = { id: "cash", name: "Everyday", kind: "cash", sortOrder: 0, closed: false, balance: { working: "1000", cleared: "600", uncleared: "400", reconciled: "0" } };
const entry = (id: string, date: string, payeeName: string): RegisterEntry => ({ id, date, payeeName, categoryId: null, categoryGroupName: null, categoryName: null, memo: "", flagId: null, flagName: null, flagColor: null, clearedState: "uncleared", postingState: "posted", origin: "manual", amount: "100", transferId: null, transferAccountId: null, transferAccountName: null, scheduleId: null, repeatIntervalMonths: null });
const workspace = { budget: { name: "Test", currency: "HUF" as const, schemaVersion: 1, databasePath: "" }, accounts: [account], transactionOptions: { payees: [], categories: [], flags: [] } };

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 16, 12)); vi.resetAllMocks(); localStorage.clear();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command) => {
    switch (String(command)) {
      case "get_workspace": return workspace;
      case "get_account_register": return [entry("oct", "2026-10-10", "Grocery Shop"), entry("sep", "2026-09-10", "Book Store")];
      case "get_all_accounts_register": return [entry("oct", "2026-10-10", "Grocery Shop")].map((row) => ({ ...row, accountId: "cash", accountName: "Everyday" }));
      case "realize_due_scheduled_transactions": return 0;
      case "get_plan_month": return { month: "2026-10", readyToAssign: "0", categories: [], creditPaymentCategories: [] };
      case "get_undo_status": return { canUndo: false, label: null };
      case "list_native_backups": return { directory: "", names: [] };
      default: return undefined;
    }
  });
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function flush() { for (let i = 0; i < 35; i += 1) await Promise.resolve(); }

it("searches an individual register and applies the View date filter", async () => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  localStorage.setItem("allocash-register-view-cash", "null");
  localStorage.setItem("allocash-register-view-cash-columns", "[]");
  await act(async () => { root!.render(<App />); await flush(); });
  await act(async () => { host!.querySelector<HTMLButtonElement>(`.account-link`)!.click(); await flush(); });
  expect(host!.querySelectorAll(".register-table tbody tr[data-entry-id]")).toHaveLength(2);
  const search = host!.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "book"); search.dispatchEvent(new Event("input", { bubbles: true })); await flush(); });
  expect(host!.querySelector('[data-entry-id="sep"]')).not.toBeNull();
  expect(host!.querySelector('[data-entry-id="oct"]')).toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, ""); search.dispatchEvent(new Event("input", { bubbles: true })); await flush(); });
  await act(async () => { host!.querySelector<HTMLButtonElement>(".register-view-button")!.click(); });
  await act(async () => { host!.querySelector<HTMLButtonElement>(".register-view-presets button:nth-child(2)")!.click(); });
  await act(async () => { host!.querySelector<HTMLButtonElement>(".register-view-footer .apply")!.click(); await flush(); });
  expect(host!.querySelector('[data-entry-id="sep"]')).not.toBeNull();
  expect(host!.querySelector('[data-entry-id="oct"]')).toBeNull();
});
