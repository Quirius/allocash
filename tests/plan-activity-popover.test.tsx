// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { PlanView } from "../src/app/PlanView";
import { localCalendarMonth } from "../src/lib/format";
import { getSavedMutationVersion, type PlanSnapshot } from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
const month = localCalendarMonth();
const plan: PlanSnapshot = {
  month,
  readyToAssign: "0",
  categories: [
    { groupId: "g", groupName: "Home", categoryId: "alpha", categoryName: "Alpha", notes: "", assigned: "0", activity: "-30", available: "-30", target: null },
    { groupId: "g", groupName: "Home", categoryId: "beta", categoryName: "Beta", notes: "", assigned: "0", activity: "100", available: "100", target: null },
  ],
  creditPaymentCategories: [],
};

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? plan : undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<PlanView readEpoch={getSavedMutationVersion()} />));
  await settle();
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

it("shows signed, newest-first activity in a scrollable five-column table with a fixed Close footer", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? plan : command === "get_category_activity" ? {
    categoryId: "alpha", month, total: "-30", rows: [
      { id: "older", accountName: "Checking", date: `${month}-02`, payeeName: "Shop B", memo: "older", amount: "20" },
      { id: "newer", accountName: "Checking", date: `${month}-14`, payeeName: "Shop A", memo: "newer", amount: "-50" },
    ],
  } : undefined);
  await settle();
  act(() => host.querySelector<HTMLButtonElement>('.plan-row [aria-label^="Alpha activity"]')!.click());
  await settle();
  const dialog = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Alpha activity"]')!;
  expect([...dialog.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Account", "Date", "Payee", "Memo", "Amount"]);
  expect([...dialog.querySelectorAll("tbody tr")].map((row) => row.children[1]?.textContent)).toEqual([`${month}-14`, `${month}-02`]);
  expect(dialog.querySelector("tbody tr:first-child td:last-child")?.textContent).toContain("50 Ft");
  expect(dialog.querySelector(".plan-activity-table-scroll")?.getAttribute("role")).toBe("region");
  expect(dialog.querySelector(".plan-activity-footer button")?.textContent).toBe("Close");
  expect(invoke).toHaveBeenCalledWith("get_category_activity", { input: { categoryId: "alpha", month, asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } });
});

it("keeps loading and retry errors inside the popup, then shows an empty state", async () => {
  let resolveRead!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((command) => command === "get_plan_month" ? Promise.resolve(plan) : command === "get_category_activity" ? new Promise((resolve) => { resolveRead = resolve; }) : Promise.resolve(undefined));
  await settle();
  await act(async () => { host.querySelector<HTMLButtonElement>('.plan-row [aria-label^="Alpha activity"]')!.click(); await Promise.resolve(); });
  expect(host.querySelector('.plan-activity-status[role="status"]')?.textContent).toContain("Loading activity");
  await act(async () => { resolveRead(Promise.reject(new Error("read failed"))); await Promise.resolve(); await Promise.resolve(); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load activity");
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? plan : command === "get_category_activity" ? { categoryId: "alpha", month, total: "0", rows: [] } : undefined);
  await act(async () => { host.querySelector<HTMLButtonElement>('.plan-activity-status button')!.click(); await Promise.resolve(); await Promise.resolve(); });
  expect(host.querySelector('.plan-activity-status[role="status"]')?.textContent).toContain("No activity this month");
  expect(host.querySelector(".plan-activity-total")).toBeNull();
});

it("does not steal focus when an outside click selects another category", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? plan : command === "get_category_activity" ? { categoryId: "alpha", month, total: "-30", rows: [] } : undefined);
  await settle();
  act(() => host.querySelector<HTMLButtonElement>('.plan-row [aria-label^="Alpha activity"]')!.click());
  await settle();
  const betaRow = host.querySelectorAll<HTMLDivElement>(".plan-row")[1]!;
  act(() => betaRow.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  act(() => betaRow.querySelector(".plan-category-cell")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(host.querySelector('[role="dialog"][aria-label="Alpha activity"]')).toBeNull();
  expect(document.activeElement).toBe(betaRow.querySelector('input[aria-label="Beta assigned"]'));
});

it("ignores an old category response after a fast switch and dismisses on month change", async () => {
  const pending: Array<(value: unknown) => void> = [];
  vi.mocked(invoke).mockImplementation((command) => command === "get_plan_month" ? Promise.resolve(plan) : command === "get_category_activity" ? new Promise((resolve) => pending.push(resolve)) : Promise.resolve(undefined));
  await settle();
  act(() => host.querySelector<HTMLButtonElement>('.plan-row [aria-label^="Alpha activity"]')!.click());
  act(() => host.querySelectorAll<HTMLDivElement>(".plan-row")[1]!.querySelector<HTMLButtonElement>('[aria-label^="Beta activity"]')!.click());
  await act(async () => {
    pending[0]?.({ categoryId: "alpha", month, total: "-30", rows: [{ id: "old", accountName: "A", date: month + "-01", payeeName: "Old response", memo: "", amount: "-30" }] });
    pending[1]?.({ categoryId: "beta", month, total: "100", rows: [{ id: "new", accountName: "B", date: month + "-02", payeeName: "Current response", memo: "", amount: "100" }] });
    await Promise.resolve(); await Promise.resolve();
  });
  expect(host.querySelector('[role="dialog"][aria-label="Beta activity"]')?.textContent).toContain("Current response");
  expect(host.querySelector('[role="dialog"][aria-label="Beta activity"]')?.textContent).not.toContain("Old response");
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!.click());
  await settle();
  expect(host.querySelector('[role="dialog"][aria-label$="activity"]')).toBeNull();
});
