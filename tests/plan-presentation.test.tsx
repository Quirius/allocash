// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { PlanView } from "../src/app/PlanView";
import { localCalendarMonth } from "../src/lib/format";
import { getSavedMutationVersion, subscribeSavedMutations, type PlanSnapshot } from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
const month = localCalendarMonth();

function syntheticPlan(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    month,
    readyToAssign: "5000",
    categories: [
      { groupId: "group-one", groupName: "Shared", categoryId: "alpha", categoryName: "Alpha", notes: "", assigned: "100", activity: "-20", available: "80", target: null },
      { groupId: "group-two", groupName: "Shared", categoryId: "card-payment", categoryName: "Card Payment", notes: "", assigned: "0", activity: "-300", available: "-300", target: null },
    ],
    creditPaymentCategories: [{
      accountId: "credit-account", accountName: "Travel Card", categoryId: "card-payment", currentBalance: "-1000",
      priorBalance: "-1000", spendingAndOutflows: "0", paymentsAndInflows: "0", cashLeftOverFromLastMonth: "0",
      fundedSpending: "0", paymentsMade: "0", otherActivity: "0",
    }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? syntheticPlan() : undefined);
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

function MutationAwarePlan() {
  const [mutation, setMutation] = useState({ pending: false, version: getSavedMutationVersion() });
  useEffect(() => subscribeSavedMutations((pending, version) => setMutation({ pending, version })), []);
  return <PlanView readEpoch={mutation.version} mutationPending={mutation.pending} />;
}

async function mount(plan = syntheticPlan(), onCategoryRenamed?: () => Promise<void>, liveMutations = false) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? plan : undefined);
  act(() => root.render(liveMutations ? <MutationAwarePlan /> : <PlanView readEpoch={getSavedMutationVersion()} onCategoryRenamed={onCategoryRenamed} />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

it("loads the monthly summary without auto-selecting a category", async () => {
  await mount();
  expect(invoke).toHaveBeenCalledWith("get_plan_month", { month, asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  expect(host.querySelector(".category-details.empty")?.getAttribute("aria-label")).toBe(`${month} visible category summary`);
  expect(host.querySelector(".plan-summary")?.textContent).toContain("100 Ft");
  expect(host.querySelector(".plan-summary")?.textContent).toContain("320 Ft");
  expect(host.querySelector(".plan-summary")?.textContent).toContain("220 Ft");
  expect(host.querySelector(".category-details:not(.empty)")).toBeNull();
});

it("searches categories, filters underfunded credit payment categories, and keeps equal-name groups separate", async () => {
  await mount();
  expect(host.querySelectorAll(".plan-group")).toHaveLength(2);
  expect([...host.querySelectorAll(".plan-group")].map((group) => group.querySelectorAll(".plan-row").length)).toEqual([1, 1]);

  const search = host.querySelector<HTMLInputElement>(".plan-search input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "alpha");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelectorAll(".plan-row")).toHaveLength(1);
  expect([...host.querySelectorAll(".plan-category-label")].map((label) => label.textContent)).toEqual(["Alpha"]);

  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => ([...host.querySelectorAll<HTMLButtonElement>(".plan-filters button")].find((button) => button.textContent === "Underfunded")!).click());
  expect(host.querySelectorAll(".plan-row")).toHaveLength(1);
  expect([...host.querySelectorAll(".plan-category-label")].map((label) => label.textContent)).toEqual(["Card Payment"]);
  expect(host.querySelector(".plan-available")?.classList.contains("overspent")).toBe(true);
});

it("collapses a category group without writing Plan data", async () => {
  await mount();
  const groups = [...host.querySelectorAll(".plan-group")];
  act(() => groups[0]!.querySelector(".plan-group-heading")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(groups[0]!.querySelector(".plan-row")).toBeNull();
  expect(groups[0]!.querySelector(".plan-group-heading")?.getAttribute("aria-expanded")).toBe("false");
  expect(groups[1]!.querySelector(".plan-row .plan-category-label")?.textContent).toBe("Card Payment");
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["get_plan_month", "get_hidden_categories"]);
});

it("opens the name popup, while clicking other row content focuses Assigned and Available keeps its popup", async () => {
  await mount();
  const row = host.querySelector('.plan-row')!;
  const input = row.querySelector<HTMLInputElement>('input[aria-label="Alpha assigned"]')!;
  act(() => row.querySelector<HTMLButtonElement>('.plan-category-name')!.click());
  expect(document.activeElement).toBe(document.querySelector('#category-action-name'));
  expect(host.querySelector('[role="dialog"][aria-label="Alpha actions"]')).not.toBeNull();
  act(() => host.querySelector<HTMLButtonElement>('.plan-category-actions-row > div:last-child button:first-child')!.click());
  act(() => row.querySelector('.plan-row span:nth-child(3)')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  act(() => row.querySelector<HTMLButtonElement>('.plan-available')!.click());
  expect(document.activeElement).toBe(document.querySelector('input[aria-label="Move amount"]'));
});

it("renames from the category popup and keeps category actions out of row assignment focus", async () => {
  await mount();
  const nameButton = host.querySelector<HTMLButtonElement>('.plan-category-name')!;
  act(() => nameButton.click());
  const name = document.querySelector<HTMLInputElement>('#category-action-name')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, '  Groceries  '); name.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { host.querySelector<HTMLButtonElement>('.plan-category-actions-row > div:last-child button:last-child')!.click(); await Promise.resolve(); });
  expect(invoke).toHaveBeenCalledWith('rename_category', { input: { categoryId: 'alpha', name: 'Groceries' } });
  expect(host.querySelector('[role="dialog"][aria-label="Alpha actions"]')).toBeNull();
});

it("hides, then offers an unhide action from Hidden Categories", async () => {
  const hidden = [{ groupId: 'group-one', groupName: 'Shared', categoryId: 'alpha', categoryName: 'Alpha' }];
  let refresh!: () => Promise<void>;
  refresh = async () => { root.render(<PlanView readEpoch={getSavedMutationVersion()} onCategoryRenamed={refresh} />); await Promise.resolve(); };
  await mount(syntheticPlan(), refresh);
  vi.mocked(invoke).mockImplementation(async (command) => command === 'get_plan_month' ? syntheticPlan() : command === 'get_hidden_categories' ? hidden : undefined);
  act(() => host.querySelector<HTMLButtonElement>('.plan-category-name')!.click());
  await act(async () => { host.querySelector<HTMLButtonElement>('.plan-category-actions button')!.click(); await Promise.resolve(); await Promise.resolve(); });
  expect(invoke).toHaveBeenCalledWith('set_category_hidden', { input: { categoryId: 'alpha', hidden: true } });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const hiddenSection = host.querySelector<HTMLDetailsElement>('.plan-hidden-categories')!;
  act(() => hiddenSection.querySelector('summary')!.click());
  expect(hiddenSection.textContent).toContain('Alpha');
  await act(async () => { hiddenSection.querySelector<HTMLButtonElement>('button')!.click(); await Promise.resolve(); await Promise.resolve(); });
  expect(invoke).toHaveBeenCalledWith('set_category_hidden', { input: { categoryId: 'alpha', hidden: false } });
});

it("requires a destination before deleting and retains the chooser when deletion fails", async () => {
  const plan = syntheticPlan({ categories: [...syntheticPlan().categories, { groupId: "group-one", groupName: "Shared", categoryId: "__no_history__", categoryName: "Other", notes: "", assigned: "0", activity: "0", available: "0", target: null }] });
  await mount(plan, undefined, true);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "get_plan_month") return plan;
    if (command === "get_hidden_categories") return [];
    if (command === "delete_category") throw new Error("Category has history; choose a destination category.");
    return undefined;
  });
  act(() => host.querySelector<HTMLButtonElement>(".plan-category-name")!.click());
  act(() => host.querySelector<HTMLButtonElement>(".plan-category-actions button.danger")!.click());
  const destination = document.querySelector<HTMLSelectElement>("#category-delete-destination")!;
  act(() => { destination.value = "category:__no_history__"; destination.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { document.querySelector<HTMLButtonElement>(".plan-category-delete button.danger")!.click(); await Promise.resolve(); });
  expect(invoke).toHaveBeenCalledWith("delete_category", { input: { categoryId: "alpha", destinationCategoryId: "__no_history__" } });
  expect(document.querySelector<HTMLSelectElement>("#category-delete-destination")?.value).toBe("category:__no_history__");
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "get_plan_month").length).toBeGreaterThan(1);
  expect(document.querySelector(".plan-category-action-error")?.textContent).toContain("choose a destination");
});

it("keeps a failed hidden-list refresh retryable without repeating the saved hide", async () => {
  await mount();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "get_plan_month") return syntheticPlan();
    if (command === "get_hidden_categories") throw new Error("read failed");
    return undefined;
  });
  act(() => host.querySelector<HTMLButtonElement>(".plan-category-name")!.click());
  await act(async () => { host.querySelector<HTMLButtonElement>(".plan-category-actions button")!.click(); await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(host.textContent).toContain("Hidden Categories could not refresh");
  expect(host.querySelector<HTMLButtonElement>(".editor-error button")?.textContent).toBe("Retry Plan refresh");
  await act(async () => { host.querySelector<HTMLButtonElement>(".editor-error button")!.click(); await Promise.resolve(); await Promise.resolve(); });
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "set_category_hidden")).toHaveLength(1);
  expect(host.querySelector<HTMLButtonElement>(".editor-error button")?.textContent).toBe("Retry Plan refresh");
});

it("keeps an invalid assignment draft visible after blur", async () => {
  await mount();
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Alpha assigned"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, "12+oops");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new FocusEvent("blur", { bubbles: false })); await Promise.resolve(); });
  expect(input.closest(".plan-assignment-field")?.classList.contains("has-draft")).toBe(true);
  expect(input.value).toBe("12+oops");
});

it("limits category actions to name clicks or right-click, leaving funding bars and inputs alone", async () => {
  const plan = syntheticPlan();
  plan.categories[0]!.target = { behavior: "refill", amount: "100", dueKind: "last_day", dueDay: null, intervalMonths: 1, firstDueMonth: null, dueMonth: month, neededThisMonth: "100", funded: "100", toGo: "0", snoozed: false };
  await mount(plan);
  const row = host.querySelector<HTMLElement>(".plan-row")!;
  const name = row.querySelector<HTMLButtonElement>(".plan-category-name")!;
  const assigned = row.querySelector<HTMLInputElement>("input[data-plan-month]")!;
  const meter = row.querySelector<HTMLElement>(".plan-target-meter")!;
  const funding = row.querySelector<HTMLElement>(".plan-category-progress")!;
  expect(name.contains(meter)).toBe(false);
  expect(name.contains(funding)).toBe(false);
  for (const target of [meter, funding, row.querySelector(".plan-category-cell")!]) {
    act(() => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.querySelector(".plan-category-actions")).toBeNull();
    expect(document.activeElement).toBe(assigned);
  }
  const context = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  act(() => funding.dispatchEvent(context));
  expect(context.defaultPrevented).toBe(true);
  expect(host.querySelector('[role="dialog"][aria-label="Alpha actions"]')).not.toBeNull();
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  const inputContext = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  act(() => assigned.dispatchEvent(inputContext));
  expect(inputContext.defaultPrevented).toBe(false);
  expect(host.querySelector(".plan-category-actions")).toBeNull();
});
