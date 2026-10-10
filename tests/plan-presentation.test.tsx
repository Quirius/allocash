// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { PlanView } from "../src/app/PlanView";
import { localCalendarMonth } from "../src/lib/format";
import type { PlanSnapshot } from "../src/lib/desktop";

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

async function mount(plan = syntheticPlan()) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? plan : undefined);
  act(() => root.render(<PlanView />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

it("loads the monthly summary without auto-selecting a category", async () => {
  await mount();
  expect(invoke).toHaveBeenCalledWith("get_plan_month", { month, asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  expect(host.querySelector(".category-details.empty")?.getAttribute("aria-label")).toBe(`${month} monthly summary`);
  expect(host.querySelector(".plan-summary")?.textContent).toContain("100 Ft");
  expect(host.querySelector(".plan-summary")?.textContent).toContain("−320 Ft");
  expect(host.querySelector(".plan-summary")?.textContent).toContain("−220 Ft");
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
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["get_plan_month"]);
});
