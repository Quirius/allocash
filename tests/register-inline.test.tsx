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

function mount(entries: RegisterEntry[], onChanged = vi.fn(async () => {}), currentAccount = account, accountList = accounts) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<AccountRegister account={currentAccount} accounts={accountList} options={options}
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

const focusFields = ["flag", "date", "payee", "category", "memo", "outflow", "inflow"] as const;
it.each(["past", "upcoming"] as const)("double-clicking each %s register cell focuses its matching edit control", (kind) => {
  const item = kind === "past" ? entry() : entry({ id: "future", date: "2026-11-10", payeeName: "Insurance", clearedState: "uncleared" });
  for (const fieldName of focusFields) {
    if (fieldName === "inflow") item.amount = "1200";
    else if (fieldName === "outflow") item.amount = "-1200";
    mount([item]);
    const row = host.querySelector(`[data-entry-id="${item.id}"]`)!;
    act(() => row.querySelector(`[data-register-field="${fieldName}"]`)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const editor = host.querySelector(`tr.register-edit-row[data-entry-id="${item.id}"]`)!;
    expect(host.querySelector(".new-entry-row")).toBeNull();
    const marker = editor.querySelector<HTMLElement>(`[data-register-editor-field="${fieldName}"]`)!;
    const target = fieldName === "date" ? marker.querySelector<HTMLButtonElement>(".date-picker-trigger")! : marker.matches("input,select") ? marker : marker.querySelector("input,select")!;
    expect(document.activeElement, `${kind} ${fieldName}`).toBe(target);
    if (target instanceof HTMLInputElement && ["payee", "memo", "outflow", "inflow"].includes(fieldName)) {
      expect(target.selectionStart).toBe(0);
      expect(target.selectionEnd).toBe(target.value.length);
    }
    if (fieldName === "date") {
      expect(target.getAttribute("aria-expanded")).toBe("false");
      expect(document.querySelector(".date-repeat-popover")).toBeNull();
    }
    act(() => button("Cancel", editor).click());
    expect(invoke).not.toHaveBeenCalled();
    act(() => root.unmount()); host.remove();
  }
});

it("falls back from a disabled category control to Payee", () => {
  const tracking: AccountOverview = { ...account, id: "tracking", name: "Investment", kind: "tracking" };
  mount([entry()], undefined, tracking, [tracking, account, ...accounts.slice(1)]);
  const row = host.querySelector('[data-entry-id="past"]')!;
  act(() => row.querySelector('[data-register-field="category"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  const category = host.querySelector<HTMLSelectElement>('[data-register-editor-field="category"]')!;
  const payee = host.querySelector<HTMLInputElement>('[data-register-editor-field="payee"]')!;
  expect(category.disabled).toBe(true);
  expect(document.activeElement).toBe(payee);
  expect(payee.selectionStart).toBe(0);
  expect(payee.selectionEnd).toBe(payee.value.length);
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps generic Enter editing focused on Payee and leaves status-button double-click behavior alone", () => {
  mount([entry({ clearedState: "uncleared" })]);
  const row = host.querySelector<HTMLElement>('[data-entry-id="past"]')!;
  act(() => row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(document.activeElement).toBe(host.querySelector('[data-register-editor-field="payee"]'));
  act(() => button("Cancel", host).click());
  const statusButton = host.querySelector('[data-entry-id="past"] .status-column button')!;
  act(() => statusButton.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(host.querySelector(".transaction-inline")).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps generic context-menu Edit on Payee and routes Edit Memo to Memo", () => {
  mount([entry()]);
  const row = host.querySelector<HTMLElement>('[data-entry-id="past"]')!;
  act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 })));
  act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("Edit"))!.click());
  expect(document.activeElement).toBe(host.querySelector('[data-register-editor-field="payee"]'));
  act(() => button("Cancel", host).click());
  act(() => host.querySelector('[data-entry-id="past"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 })));
  act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("Edit Memo"))!.click());
  const memo = host.querySelector<HTMLInputElement>('[data-register-editor-field="memo"]')!;
  expect(document.activeElement).toBe(memo);
  expect(memo.selectionStart).toBe(0);
  expect(memo.selectionEnd).toBe(memo.value.length);
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
