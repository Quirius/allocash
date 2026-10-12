// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { PlanView } from "../src/app/PlanView";
import { getSavedMutationVersion, type PlanSnapshot } from "../src/lib/desktop";
import { localCalendarMonth } from "../src/lib/format";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
const month = localCalendarMonth();
const readySource = "__ready_to_assign_source__";

function snapshot(): PlanSnapshot {
  return {
    month, readyToAssign: "3000", categories: [
      { groupId: "home", groupName: "Home", categoryId: "rent", categoryName: "Rent", notes: "", assigned: "300", activity: "-450", available: "-150", target: null },
      { groupId: "home", groupName: "Home", categoryId: "food", categoryName: "Food", notes: "", assigned: "1200", activity: "0", available: "1200", target: null },
      { groupId: "inflow", groupName: "Inflow", categoryId: "rta-row", categoryName: "Ready to Assign", notes: "", assigned: "0", activity: "0", available: "0", target: null },
      { groupId: "cards", groupName: "Credit Cards", categoryId: "card", categoryName: "Travel Card Payment", notes: "", assigned: "50", activity: "0", available: "200", target: null },
    ], creditPaymentCategories: [{
      accountId: "card-account", accountName: "Travel Card", categoryId: "card", currentBalance: "-1000", priorBalance: "-1000",
      spendingAndOutflows: "0", paymentsAndInflows: "0", cashLeftOverFromLastMonth: "0", fundedSpending: "0", paymentsMade: "0", otherActivity: "0",
    }],
  };
}

beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? snapshot() : undefined);
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

async function mount(value = snapshot()) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? value : undefined);
  await act(async () => { root.render(<PlanView readEpoch={getSavedMutationVersion()} />); await Promise.resolve(); await Promise.resolve(); });
}
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }
function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set; setter?.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); });
}
function submitCover() { return act(async () => { document.querySelector<HTMLFormElement>(".plan-cover-popup")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); }); }

it("disables a cover gap outside the signed HUF range without sending a write", async () => {
  const value = snapshot();
  value.categories[0]!.available = "-9223372036854775808";
  await mount(value);
  click(host.querySelector('[data-category-id="rent"]')!);
  change(document.querySelector<HTMLSelectElement>('[aria-label="Cover overspending from"]')!, "food");
  expect(document.querySelector<HTMLButtonElement>('.plan-cover-popup button[type="submit"]')!.disabled).toBe(true);
  expect(document.querySelector('.plan-cover-popup [role="alert"]')?.textContent).toContain("too large");
  await submitCover();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["get_plan_month", "get_hidden_categories"]);
});

it("covers a red negative category from a chosen category in the correct direction", async () => {
  await mount();
  const trigger = host.querySelector<HTMLButtonElement>('[data-category-id="rent"]')!;
  click(trigger);
  expect(document.querySelector(".plan-cover-popup")?.getAttribute("aria-label")).toBe("Cover money into Rent");
  const source = document.querySelector<HTMLSelectElement>('[aria-label="Cover overspending from"]')!;
  expect([...source.options].map((option) => option.value)).toEqual(["", readySource, "food", "card"]);
  expect(document.querySelector(".plan-cover-popup")?.textContent).toContain("Cover 150 Ft for Rent");
  change(source, "food");
  await submitCover();
  expect(invoke).toHaveBeenCalledWith("move_plan_money", { input: { fromCategoryId: "food", toCategoryId: "rent", month, amount: "150", asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } });
});

it("covers a yellow credit-payment shortfall from Ready to Assign with the captured Assigned guard", async () => {
  await mount();
  click(host.querySelector<HTMLButtonElement>('[data-category-id="card"]')!);
  const popup = document.querySelector(".plan-cover-popup")!;
  expect(popup.textContent).toContain("Cover 800 Ft for Travel Card Payment");
  change(document.querySelector<HTMLSelectElement>('[aria-label="Cover overspending from"]')!, readySource);
  await submitCover();
  expect(invoke).toHaveBeenCalledWith("assign_ready_to_assign", { input: { categoryId: "card", month, amount: "800", expectedAssigned: "50" } });
});

it("Cancel and Escape dismiss cover selection without writing", async () => {
  await mount();
  const trigger = host.querySelector<HTMLButtonElement>('[data-category-id="rent"]')!;
  click(trigger);
  expect(document.activeElement).toBe(document.querySelector('[aria-label="Cover overspending from"]'));
  click(document.querySelector<HTMLButtonElement>(".plan-cover-popup button[type=button]")!);
  expect(document.querySelector(".plan-cover-popup")).toBeNull();
  click(trigger);
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await Promise.resolve(); });
  expect(document.querySelector(".plan-cover-popup")).toBeNull();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["get_plan_month", "get_hidden_categories"]);
});

it("does not repeat a cover write while the first request is pending", async () => {
  await mount();
  click(host.querySelector<HTMLButtonElement>('[data-category-id="rent"]')!);
  change(document.querySelector<HTMLSelectElement>('[aria-label="Cover overspending from"]')!, "food");
  let release!: () => void;
  vi.mocked(invoke).mockImplementation((async (command) => command === "move_plan_money"
    ? await new Promise<void>((resolve) => { release = resolve; })
    : command === "get_plan_month" ? snapshot() : undefined) as typeof invoke);
  await act(async () => {
    const form = document.querySelector<HTMLFormElement>(".plan-cover-popup")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "move_plan_money")).toHaveLength(1);
  expect((document.querySelector<HTMLButtonElement>(".plan-cover-popup button[type=submit]")!).disabled).toBe(true);
  await act(async () => { release(); await Promise.resolve(); });
});
