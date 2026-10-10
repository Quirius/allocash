// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RegisterEntryEditor, TransactionComposer } from "../src/app/TransactionEditor";
import type { AccountOverview, RegisterEntry, TransactionFormOptions } from "../src/lib/desktop";
import { formatDate, localCalendarDate } from "../src/lib/format";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => tauri);

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
beforeEach(() => { vi.clearAllMocks(); });

const cash: AccountOverview = {
  id: "cash", name: "Cash", kind: "cash", sortOrder: 0, closed: false,
  balance: { working: "0", cleared: "0", uncleared: "0", reconciled: "0" },
};
const bank: AccountOverview = { ...cash, id: "bank", name: "Bank", sortOrder: 1 };
const tracking: AccountOverview = { ...cash, id: "tracking", name: "Tracking", kind: "tracking", sortOrder: 2 };
const options: TransactionFormOptions = {
  payees: [{ id: "shop", name: "Shop", lastCategoryId: "food", lastDirection: "outflow" }],
  categories: [{ id: "food", groupName: "Daily", name: "Food" }],
  flags: [],
};
const entry: RegisterEntry = {
  id: "entry", date: "2026-10-02", payeeName: "Shop", categoryId: "food", categoryGroupName: "Daily", categoryName: "Food",
  memo: "", flagId: null, flagName: null, flagColor: null, clearedState: "cleared", postingState: "posted", origin: "manual",
  amount: "-1200", transferId: null, transferAccountName: null,
};

function mount(node: ReactNode) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host); act(() => root.render(node));
  return host;
}

it("renders one payee and one category control in the ordinary inline editor", () => {
  const view = mount(<RegisterEntryEditor entry={entry} account={cash} accounts={[cash, bank]} options={options} inline onMakeRepeating={vi.fn()} onSaved={vi.fn(async () => {})} onCancel={vi.fn()} />);
  const fields = view.querySelectorAll(".inline-fields > *");
  expect(fields).toHaveLength(8);
  expect(view.querySelectorAll('.inline-fields input[list="edit-payees-entry"]')).toHaveLength(1);
  expect(view.querySelectorAll(".inline-fields select")).toHaveLength(2); // flag and category, each once
  expect(view.querySelectorAll(".inline-fields > .inline-fixed-payee")).toHaveLength(0);
});

it("keeps the category slot visible but disabled for an off-budget composer", () => {
  const view = mount(<TransactionComposer account={tracking} accounts={[tracking, cash]} options={options} inline onSaved={vi.fn(async () => {})} onCancel={vi.fn()} />);
  expect(view.querySelectorAll(".inline-fields > *")).toHaveLength(8);
  const category = [...view.querySelectorAll(".inline-fields > label")].find((label) => label.textContent?.startsWith("Category"))?.querySelector("select");
  expect(category).toBeInstanceOf(HTMLSelectElement);
  expect(category?.disabled).toBe(true);
  expect(category?.options[0]?.textContent).toBe("Not used");
});

it("shows a transfer's peer as a fixed payee in the same grid slot", () => {
  const transfer: RegisterEntry = { ...entry, payeeName: null, categoryId: null, transferId: "transfer", transferAccountName: "Bank", transferAccountId: bank.id };
  const view = mount(<RegisterEntryEditor entry={transfer} account={cash} accounts={[cash, bank]} options={options} inline onMakeRepeating={vi.fn()} onSaved={vi.fn(async () => {})} onCancel={vi.fn()} />);
  expect(view.querySelectorAll(".inline-fields > *")).toHaveLength(8);
  expect(view.querySelector(".inline-fixed-payee")?.textContent).toBe("Transfer: Bank");
  expect(view.querySelectorAll('.inline-fields input[list="edit-payees-entry"]')).toHaveLength(0);
  expect([...view.querySelectorAll(".inline-fields > label")].filter((label) => label.textContent?.startsWith("Category"))).toHaveLength(1);
});

it("ignores a repeated Enter submit while the first transaction write is pending", async () => {
  let finish!: (id: string) => void;
  tauri.invoke.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  const onSaved = vi.fn(async () => {});
  const view = mount(<TransactionComposer account={cash} accounts={[cash, bank]} options={options} inline onSaved={onSaved} onCancel={vi.fn()}
    initialDraft={{ kind: "transaction", date: "2026-10-02", repeat: "never", payee: "Shop", categoryId: "food", counterpartId: "", memo: "", flagId: "", outflow: "1200", inflow: "" }} />);
  const form = view.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(tauri.invoke).toHaveBeenCalledOnce();
  await act(async () => { finish("new-entry"); await Promise.resolve(); });
  expect(onSaved).toHaveBeenCalledOnce();
});

it("saves and adds another by resetting to a blank today draft and focusing Payee", async () => {
  tauri.invoke.mockResolvedValue("new-entry");
  const onCancel = vi.fn();
  const onSaved = vi.fn(async () => {});
  const view = mount(<TransactionComposer account={cash} accounts={[cash, bank]} options={options} inline onSaved={onSaved} onCancel={onCancel}
    initialDraft={{ kind: "transfer", date: "2026-10-02", repeat: "yearly", payee: "", categoryId: "food", counterpartId: "bank", memo: "old memo", flagId: "flag", outflow: "1200", inflow: "" }} />);
  await act(async () => { view.querySelector<HTMLButtonElement>('button[name="action"]')!.click(); });
  expect(onSaved).toHaveBeenCalledOnce(); expect(onCancel).not.toHaveBeenCalled();
  expect(view.querySelector<HTMLInputElement>('input[list="payees-cash"]')?.value).toBe("");
  expect(document.activeElement).toBe(view.querySelector('input[list="payees-cash"]'));
  expect(view.querySelectorAll<HTMLInputElement>('input[placeholder="0 Ft"]')[0]?.value).toBe("");
  expect(view.querySelectorAll<HTMLInputElement>('input[placeholder="0 Ft"]')[1]?.value).toBe("");
  expect(view.querySelector<HTMLSelectElement>(".inline-secondary select")?.value).toBe("transaction");
  expect(view.querySelector(".date-picker-trigger")?.getAttribute("aria-label")).toBe(formatDate(localCalendarDate()));
});

it("retries only the register refresh after a transaction was written successfully", async () => {
  tauri.invoke.mockResolvedValue("new-entry");
  const onCancel = vi.fn();
  const onSaved = vi.fn().mockRejectedValueOnce(new Error("Refresh unavailable")).mockResolvedValueOnce(undefined);
  const view = mount(<TransactionComposer account={cash} accounts={[cash, bank]} options={options} inline onSaved={onSaved} onCancel={onCancel}
    initialDraft={{ kind: "transaction", date: "2026-10-02", repeat: "never", payee: "Shop", categoryId: "food", counterpartId: "", memo: "", flagId: "", outflow: "1200", inflow: "" }} />);
  await act(async () => { view.querySelector<HTMLButtonElement>('button[type="submit"]:not([name])')!.click(); });
  expect(tauri.invoke).toHaveBeenCalledOnce(); expect(onSaved).toHaveBeenCalledOnce(); expect(onCancel).not.toHaveBeenCalled();
  await act(async () => { [...view.querySelectorAll("button")].find((button) => button.textContent === "Retry refresh")!.click(); });
  expect(tauri.invoke).toHaveBeenCalledOnce(); expect(onSaved).toHaveBeenCalledTimes(2); expect(onCancel).toHaveBeenCalledOnce();
});

it("retries only the refresh after an edited entry write succeeds", async () => {
  tauri.invoke.mockResolvedValue(undefined);
  const onCancel = vi.fn();
  const onSaved = vi.fn().mockRejectedValueOnce(new Error("Refresh unavailable")).mockResolvedValueOnce(undefined);
  const view = mount(<RegisterEntryEditor entry={entry} account={cash} accounts={[cash, bank]} options={options} inline onMakeRepeating={vi.fn()} onSaved={onSaved} onCancel={onCancel} />);
  await act(async () => { view.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(tauri.invoke).toHaveBeenCalledOnce(); expect(onSaved).toHaveBeenCalledOnce(); expect(onCancel).not.toHaveBeenCalled();
  await act(async () => { [...view.querySelectorAll("button")].find((button) => button.textContent === "Retry refresh")!.click(); });
  expect(tauri.invoke).toHaveBeenCalledOnce(); expect(onSaved).toHaveBeenCalledTimes(2); expect(onCancel).toHaveBeenCalledOnce();
});

it("resets after a successful refresh retry for Save and add another", async () => {
  tauri.invoke.mockResolvedValue("new-entry");
  const onCancel = vi.fn();
  const onSaved = vi.fn().mockRejectedValueOnce(new Error("Refresh unavailable")).mockResolvedValueOnce(undefined);
  const view = mount(<TransactionComposer account={cash} accounts={[cash, bank]} options={options} inline onSaved={onSaved} onCancel={onCancel}
    initialDraft={{ kind: "transaction", date: "2026-10-02", repeat: "never", payee: "Shop", categoryId: "food", counterpartId: "", memo: "old", flagId: "", outflow: "1200", inflow: "" }} />);
  await act(async () => { view.querySelector<HTMLButtonElement>('button[name="action"]')!.click(); });
  expect(tauri.invoke).toHaveBeenCalledOnce(); expect(onCancel).not.toHaveBeenCalled();
  await act(async () => { [...view.querySelectorAll("button")].find((button) => button.textContent === "Retry refresh")!.click(); });
  expect(tauri.invoke).toHaveBeenCalledOnce(); expect(onCancel).not.toHaveBeenCalled();
  expect(view.querySelector<HTMLInputElement>('input[list="payees-cash"]')?.value).toBe("");
  expect(document.activeElement).toBe(view.querySelector('input[list="payees-cash"]'));
});
