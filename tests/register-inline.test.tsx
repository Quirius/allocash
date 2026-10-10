// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AccountRegister } from "../src/app/App";
import { RECONCILED_CONFIRMATION_REQUIRED, type AccountOverview, type RegisterEntry, type TransactionFormOptions } from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;

const account: AccountOverview = {
  id: "cash", name: "Everyday", kind: "cash", sortOrder: 0, closed: false,
  balance: { working: "1000", cleared: "1000", uncleared: "0", reconciled: "500" },
};
const accounts = [account, { ...account, id: "bank", name: "Bank" }];
const options: TransactionFormOptions = {
  payees: [], categories: [
    { id: "food", groupName: "Living", name: "Food" },
    { id: "ready", groupName: "Inflow", name: "Ready to Assign" },
  ], flags: [{ id: "orange", name: "Review", color: "orange" }],
};
const entry = (overrides: Partial<RegisterEntry> = {}): RegisterEntry => ({
  id: "past", date: "2026-09-10", payeeName: "Market", categoryId: "food",
  categoryGroupName: "Living", categoryName: "Food", memo: "weekly shop", flagId: null,
  flagName: null, flagColor: null, clearedState: "reconciled", postingState: "posted",
  origin: "manual", amount: "-1200", transferId: null, transferAccountName: null,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.restoreAllMocks(); });

function mount(entries: RegisterEntry[], onChanged = vi.fn(async () => {})) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<AccountRegister account={account} accounts={accounts} options={options}
    register={{ status: "ready", entries }} onRetry={vi.fn()} onChanged={onChanged} />));
  return { onChanged };
}
function button(name: string, within: ParentNode = host) {
  const found = [...within.querySelectorAll("button")].find((item) => item.textContent?.trim() === name);
  if (!found) throw new Error(`Could not find button ${name}`);
  return found;
}
function setInput(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function field(labelText: string, within: ParentNode = host): HTMLInputElement | HTMLSelectElement {
  const label = [...within.querySelectorAll("label")].find((item) => item.textContent?.trim().startsWith(labelText));
  const control = label?.querySelector("input, select");
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) throw new Error(`Could not find field ${labelText}`);
  return control;
}

it.each([
  ["historical", entry()],
  ["upcoming", entry({ id: "future", date: "2026-11-10", payeeName: "Insurance", clearedState: "uncleared", amount: "-5000" })],
])("opens and cancels a %s edit in place without a write", (_kind, item) => {
  mount([entry({ id: "first", date: "2026-07-10" }), item, entry({ id: "last", date: "2026-08-10" })]);
  const tbody = host.querySelector("tbody")!;
  const originalRow = tbody.querySelector(`[data-entry-id="${item.id}"]`)!;
  const originalIndex = [...tbody.rows].indexOf(originalRow as HTMLTableRowElement);
  act(() => originalRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(tbody.querySelector(`tr.register-edit-row[data-entry-id="${item.id}"]`)).not.toBeNull();
  const editingRow = tbody.querySelector(`tr.register-edit-row[data-entry-id="${item.id}"]`)!;
  expect([...tbody.rows].indexOf(editingRow as HTMLTableRowElement)).toBe(originalIndex);
  act(() => button("Cancel", editingRow).click());
  expect(tbody.querySelector(`tr.register-edit-row[data-entry-id="${item.id}"]`)).toBeNull();
  expect(tbody.querySelector(`[data-entry-id="${item.id}"]`)).not.toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("inserts Add transaction as the first body row, even with existing history", () => {
  mount([entry(), entry({ id: "older", date: "2026-08-10" })]);
  act(() => button("+ Add transaction").click());
  const tbody = host.querySelector("tbody")!;
  expect(tbody.rows[0]?.classList.contains("new-entry-row")).toBe(true);
  expect(tbody.querySelector(".new-entry-row .transaction-inline")).not.toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("allows creating a transaction from the empty register through the existing command", async () => {
  mount([]);
  expect(host.textContent).toContain("No transactions in this account yet.");
  act(() => button("+ Add transaction").click());
  const form = host.querySelector("form.transaction-inline")!;
  setInput(field("Payee", form) as HTMLInputElement, "Market");
  act(() => {
    const category = field("Category", form) as HTMLSelectElement;
    category.value = "food";
    category.dispatchEvent(new Event("change", { bubbles: true }));
  });
  setInput(field("Outflow", form) as HTMLInputElement, "1200");
  await act(async () => button("Save transaction", form).click());
  expect(invoke).toHaveBeenCalledWith("create_manual_transaction", { input: expect.objectContaining({
    accountId: "cash", payeeName: "Market", categoryId: "food", amount: "-1200",
  }) });
});

it("uses the existing edit command and requires explicit confirmation for reconciled changes", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "update_register_entry" && vi.mocked(invoke).mock.calls.filter(([name]) => name === command).length === 1) {
      throw RECONCILED_CONFIRMATION_REQUIRED;
    }
    return undefined;
  });
  mount([entry()]);
  act(() => host.querySelector('[data-entry-id="past"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  const form = host.querySelector("form.transaction-inline")!;
  setInput(field("Outflow", form) as HTMLInputElement, "2000");
  await act(async () => button("Save changes", form).click());
  const updates = vi.mocked(invoke).mock.calls.filter(([command]) => command === "update_register_entry");
  expect(updates).toHaveLength(2);
  expect(updates[0]?.[1]).toEqual({ edit: expect.objectContaining({ id: "past", amount: "-2000", clearedState: "reconciled", confirmed: false }) });
  expect(updates[1]?.[1]).toEqual({ edit: expect.objectContaining({ id: "past", amount: "-2000", clearedState: "reconciled", confirmed: true }) });
  expect(window.confirm).toHaveBeenCalledWith("This change affects reconciled history. Apply it anyway?");
});

it("preserves the signed 64-bit minimum while saving an edit", async () => {
  mount([entry({ id: "minimum", amount: "-9223372036854775808", memo: "before" })]);
  act(() => host.querySelector('[data-entry-id="minimum"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  const form = host.querySelector("form.transaction-inline")!;
  expect((field("Outflow", form) as HTMLInputElement).value).toBe("9223372036854775808");
  setInput(field("Memo", form) as HTMLInputElement, "preserve minimum");
  await act(async () => button("Save changes", form).click());
  expect(invoke).toHaveBeenCalledWith("update_register_entry", { edit: expect.objectContaining({
    id: "minimum", amount: "-9223372036854775808", memo: "preserve minimum", confirmed: false,
  }) });
});
