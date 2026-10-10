// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { App } from "../src/app/App";
import { RECONCILED_CONFIRMATION_REQUIRED, type RegisterEntry } from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
let workspaceReads: number;
let rejectFirstRefresh: boolean;
const account = {
  id: "cash", name: "Everyday", kind: "cash" as const, sortOrder: 0, closed: false,
  balance: { working: "1000", cleared: "500", uncleared: "500", reconciled: "0" },
};
const item = (overrides: Partial<RegisterEntry> = {}): RegisterEntry => ({
  id: "past", date: "2026-10-09", payeeName: "Market", categoryId: "food",
  categoryGroupName: "Living", categoryName: "Food", memo: "weekly shop", flagId: null,
  flagName: null, flagColor: null, clearedState: "uncleared", postingState: "posted",
  origin: "manual", amount: "-1200", transferId: null, transferAccountName: null,
  ...overrides,
});
const workspace = {
  budget: { name: "Test budget", currency: "HUF" as const, schemaVersion: 1, databasePath: "" },
  accounts: [account],
  transactionOptions: { payees: [], categories: [{ id: "food", groupName: "Living", name: "Food" }], flags: [] },
};
const plan = { month: "2026-10", readyToAssign: "0", categories: [], creditPaymentCategories: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12));
  workspaceReads = 0; rejectFirstRefresh = false;
  vi.mocked(isTauri).mockReturnValue(true);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    switch (String(command)) {
      case "realize_due_scheduled_transactions": return 0;
      case "get_workspace":
        workspaceReads += 1;
        if (rejectFirstRefresh && workspaceReads === 2) throw new Error("refresh failed");
        return workspace;
      case "get_account_register": return [item()];
      case "get_plan_month": return plan;
      case "get_undo_status": return { canUndo: false, label: null };
      case "list_native_backups": return { directory: "", names: [] };
      case "delete_register_entry":
        if ((args as { confirmed?: boolean } | undefined)?.confirmed === false) throw RECONCILED_CONFIRMATION_REQUIRED;
        return undefined;
      default: return undefined;
    }
  });
});
afterEach(() => {
  act(() => root?.unmount()); host?.remove(); vi.restoreAllMocks(); vi.useRealTimers();
});

async function mount(entries: RegisterEntry[] = [item()]) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    switch (String(command)) {
      case "realize_due_scheduled_transactions": return 0;
      case "get_workspace":
        workspaceReads += 1;
        if (rejectFirstRefresh && workspaceReads === 2) throw new Error("refresh failed");
        return workspace;
      case "get_account_register": return entries;
      case "get_plan_month": return plan;
      case "get_undo_status": return { canUndo: false, label: null };
      case "list_native_backups": return { directory: "", names: [] };
      case "delete_register_entry":
        if ((args as { confirmed?: boolean } | undefined)?.confirmed === false) throw RECONCILED_CONFIRMATION_REQUIRED;
        return undefined;
      default: return undefined;
    }
  });
  await act(async () => { root.render(<App />); for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
  await act(async () => { [...host.querySelectorAll("button")].find((button) => button.title === "Accounts")?.click(); for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
}
function contextMenu(id = "past"): HTMLElement {
  const row = host.querySelector(`[data-entry-id="${id}"]`);
  if (!row) throw new Error(`Missing register row ${id}`);
  act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 })));
  return document.body.querySelector('[role="menu"]')!;
}
function menuItem(menu: ParentNode, label: string): HTMLButtonElement {
  const result = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.includes(label));
  if (!result) throw new Error(`Missing menu item ${label}`);
  return result;
}
async function flush() { await act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); }); }

it("realizes due schedules before loading the workspace on startup", async () => {
  await mount();
  const calls = vi.mocked(invoke).mock.calls.map(([command]) => String(command));
  expect(calls.indexOf("realize_due_scheduled_transactions")).toBeGreaterThanOrEqual(0);
  expect(calls.indexOf("realize_due_scheduled_transactions")).toBeLessThan(calls.indexOf("get_workspace"));
  expect(vi.mocked(invoke)).toHaveBeenCalledWith("realize_due_scheduled_transactions", { asOf: "2026-10-10" });
});

it("uses the dedicated status command for a past non-reconciled icon and does not repeat it after refresh retry", async () => {
  rejectFirstRefresh = true;
  await mount();
  const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Mark as cleared"]')!;
  await act(async () => { toggle.click(); for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
  expect(invoke).toHaveBeenCalledWith("set_register_entry_cleared_state", { id: "past", clearedState: "cleared", asOf: "2026-10-10" });
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "set_register_entry_cleared_state")).toHaveLength(1);
  expect(host.textContent).toContain("Saved, but the register could not refresh.");
  await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry refresh")?.click(); for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "set_register_entry_cleared_state")).toHaveLength(1);
});

it("locks reconciled, pending, and future status changes in the register and menu", async () => {
  await mount([
    item({ id: "locked", clearedState: "reconciled" }),
    item({ id: "pending", date: "2026-10-09", postingState: "scheduled", origin: "schedule", clearedState: "uncleared" }),
    item({ id: "future", date: "2026-11-01", clearedState: "uncleared" }),
  ]);
  expect(host.querySelector('[data-entry-id="locked"] button.transaction-status-icon')).toBeNull();
  for (const id of ["pending", "future"]) {
    expect(host.querySelector(`[data-entry-id="${id}"] .transaction-status-icon`)).toBeNull();
    const menu = contextMenu(id);
    expect(menuItem(menu, "Mark as Cleared").disabled).toBe(true);
  }
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "set_register_entry_cleared_state")).toBe(false);
});

it("edits a row from its context menu in place", async () => {
  await mount();
  const row = host.querySelector('[data-entry-id="past"]')!;
  const originalIndex = [...host.querySelector("tbody")!.rows].indexOf(row as HTMLTableRowElement);
  const menu = contextMenu();
  act(() => menuItem(menu, "Edit").click());
  const editRow = host.querySelector('tr.register-edit-row[data-entry-id="past"]')!;
  expect([...host.querySelector("tbody")!.rows].indexOf(editRow as HTMLTableRowElement)).toBe(originalIndex);
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "update_register_entry")).toBe(false);
});

it("denying the initial delete confirmation performs no writes", async () => {
  await mount();
  vi.mocked(window.confirm).mockReturnValue(false);
  const menu = contextMenu();
  act(() => menuItem(menu, "Delete").click());
  await flush();
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "delete_register_entry")).toBe(false);
});

it("requires separate reconciled deletion confirmation after the initial confirmation", async () => {
  await mount([item({ clearedState: "reconciled" })]);
  vi.mocked(window.confirm).mockReturnValue(true);
  const menu = contextMenu();
  act(() => menuItem(menu, "Delete").click());
  await flush();
  expect(window.confirm).toHaveBeenNthCalledWith(1, "Delete this transaction?");
  expect(window.confirm).toHaveBeenNthCalledWith(2, "This changes reconciled history. Delete it after making a safety backup?");
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "delete_register_entry").map(([, args]) => args)).toEqual([
    { id: "past", confirmed: false }, { id: "past", confirmed: true },
  ]);
});

it.each(["Duplicate", "Make Repeating"])("opens an unsaved %s draft without writing", async (label) => {
  await mount();
  const menu = contextMenu();
  act(() => menuItem(menu, label).click());
  expect(host.querySelector("form.transaction-inline")).not.toBeNull();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => ["create_manual_transaction", "update_register_entry", "create_monthly_schedule"].includes(String(command)))).toBe(false);
});
