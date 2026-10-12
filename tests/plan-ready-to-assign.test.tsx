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
function snapshot(readyToAssign = "5000", includeBreakdown = true): PlanSnapshot {
  return {
    month, readyToAssign,
    ...(includeBreakdown ? { readyToAssignBreakdown: { leftoverFromLastMonth: "200", incomeThisMonth: "6000", assignedThisMonth: "-1000", cashOverspendingFromLastMonth: "200" } } : {}),
    categories: [
      { groupId: "group-a", groupName: "Home", categoryId: "rent", categoryName: "Rent", notes: "", assigned: "100", activity: "0", available: "100", target: null },
      { groupId: "group-a", groupName: "Home", categoryId: "food", categoryName: "Food", notes: "", assigned: "0", activity: "0", available: "0", target: null },
    ],
    creditPaymentCategories: [],
  };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? snapshot() : undefined);
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
async function mount(value = snapshot(), epoch = getSavedMutationVersion()) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? value : undefined);
  await act(async () => { root.render(<PlanView readEpoch={epoch} />); await Promise.resolve(); await Promise.resolve(); });
}
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }
function assignmentCalls() { return vi.mocked(invoke).mock.calls.filter(([command]) => command === "assign_ready_to_assign").length; }
function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set; setter?.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); });
}

it.each([
  ["5000", "positive", "Ready to Assign"],
  ["0", "zero", "All Money Assigned"],
  ["-500", "negative", "Overassigned"],
] as const)("shows the %s Ready to Assign state", async (amount, state, label) => {
  await mount(snapshot(amount));
  expect(host.querySelector(".plan-rta")?.classList.contains(state)).toBe(true);
  expect(host.querySelector(".plan-rta")?.textContent).toContain(label);
  if (amount === "0") expect(host.querySelector(".rta-check")).not.toBeNull();
  expect(host.querySelector(".plan-rta-assign") !== null).toBe(amount === "5000");
});

it("shows backend breakdown rows and reports unavailable breakdowns without inventing values", async () => {
  await mount(snapshot("5000"));
  click(host.querySelector(".plan-rta-breakdown")!);
  expect(document.querySelector('[aria-label="Ready to Assign Breakdown"]')?.textContent).toContain("Ready to Assign left over from");
  expect(document.querySelector('[aria-label="Ready to Assign Breakdown"]')?.textContent).toContain("Cash overspending from September");
  expect(document.querySelector(".rta-breakdown-total")?.textContent).toContain("5 000 Ft");
  expect([...document.querySelectorAll(".rta-breakdown-row strong")].map((item) => item.textContent).join(" ")).toContain("1 000 Ft");
  await act(async () => { root.unmount(); });
  host.remove(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? snapshot("300", false) : undefined);
  await act(async () => { root.render(<PlanView readEpoch={getSavedMutationVersion()} refreshRevision={1} />); await Promise.resolve(); await Promise.resolve(); });
  click(host.querySelector(".plan-rta-breakdown")!);
  expect(document.querySelector(".rta-breakdown-card")?.textContent).toContain("Breakdown unavailable");
  expect(document.querySelector(".rta-breakdown-card")?.textContent).not.toContain("Ready to Assign left over");
});

it("disables the breakdown and manual assignment while this Plan snapshot is stale", async () => {
  await mount();
  await act(async () => { root.render(<PlanView readEpoch={getSavedMutationVersion() + 1} />); await Promise.resolve(); });
  expect((host.querySelector(".plan-rta-breakdown") as HTMLButtonElement).disabled).toBe(true);
  expect((host.querySelector(".plan-rta-assign") as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector(".rta-popup")).toBeNull();
});

it("rejects a category whose Assigned value changed while the popup was open", async () => {
  await mount();
  click(host.querySelector(".plan-rta-assign")!);
  change(document.querySelector<HTMLSelectElement>('[aria-label="Assign to category"]')!, "rent");
  const changed = snapshot();
  changed.categories[0]!.assigned = "150";
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? changed : undefined);
  await act(async () => { root.render(<PlanView readEpoch={getSavedMutationVersion()} refreshRevision={1} />); await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { document.querySelector(".rta-assign-scroll")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
  expect(document.querySelector(".rta-error")?.textContent).toContain("This category changed");
  expect(assignmentCalls()).toBe(0);
});

it("requires a positive whole HUF amount before calling the bridge", async () => {
  await mount();
  click(host.querySelector(".plan-rta-assign")!);
  change(document.querySelector<HTMLSelectElement>('[aria-label="Assign to category"]')!, "rent");
  change(document.querySelector<HTMLInputElement>('[aria-label="Amount to assign"]')!, "0");
  await act(async () => { document.querySelector(".rta-assign-scroll")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(document.querySelector(".rta-error")?.textContent).toContain("greater than zero");
  expect(assignmentCalls()).toBe(0);
  change(document.querySelector<HTMLInputElement>('[aria-label="Amount to assign"]')!, "50.5");
  await act(async () => { document.querySelector(".rta-assign-scroll")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(document.querySelector(".rta-error")?.textContent).toContain("positive whole HUF");
  expect(assignmentCalls()).toBe(0);
});

it("submits an increment of 50 with the current Assigned guard and holds the dialog until the fresh Plan arrives", async () => {
  await mount();
  click(host.querySelector(".plan-rta-assign")!);
  const input = document.querySelector<HTMLInputElement>('[aria-label="Amount to assign"]')!;
  expect(input.value).toBe("5000");
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Assign to category"]')!.value).toBe("");
  change(input, "50");
  change(document.querySelector<HTMLSelectElement>('[aria-label="Assign to category"]')!, "rent");
  const form = document.querySelector<HTMLFormElement>(".rta-assign-scroll")!;
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); });
  expect(invoke).toHaveBeenCalledWith("assign_ready_to_assign", { input: { categoryId: "rent", month, amount: "50", expectedAssigned: "100" } });
  expect(document.querySelector(".rta-assign-popup")?.textContent).toContain("Saving…");
  const nextEpoch = getSavedMutationVersion();
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? snapshot("4950") : undefined);
  await act(async () => { root.render(<PlanView readEpoch={nextEpoch} refreshRevision={1} />); await Promise.resolve(); await Promise.resolve(); });
  expect(document.querySelector(".rta-assign-popup")).toBeNull();
});

it("retries a failed Plan read after a successful assignment without repeating the assignment", async () => {
  await mount();
  click(host.querySelector(".plan-rta-assign")!);
  change(document.querySelector<HTMLSelectElement>('[aria-label="Assign to category"]')!, "rent");
  vi.mocked(invoke).mockImplementation(async (command) => command === "assign_ready_to_assign" ? undefined : undefined);
  await act(async () => { document.querySelector(".rta-assign-scroll")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); });
  const epoch = getSavedMutationVersion();
  vi.mocked(invoke).mockImplementation(async (command) => { if (command === "get_plan_month") throw new Error("read failed"); return undefined; });
  await act(async () => { root.render(<PlanView readEpoch={epoch} refreshRevision={1} />); await Promise.resolve(); await Promise.resolve(); });
  expect(document.querySelector(".rta-assign-popup")).not.toBeNull();
  expect(document.querySelector<HTMLButtonElement>(".rta-actions button[type=submit]")?.disabled).toBe(true);
  expect(host.querySelector(".editor-error")?.textContent).toContain("Could not load this Plan month");
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_plan_month" ? snapshot("4950") : undefined);
  await act(async () => { host.querySelector<HTMLButtonElement>(".editor-error button")!.click(); await Promise.resolve(); await Promise.resolve(); });
  expect(document.querySelector(".rta-assign-popup")).toBeNull();
  expect(assignmentCalls()).toBe(1);
});

it("Cancel and Escape close without writing and restore focus", async () => {
  await mount();
  const trigger = host.querySelector<HTMLButtonElement>(".plan-rta-assign")!;
  click(trigger);
  click(document.querySelector(".rta-actions button[type=button]")!);
  expect(document.querySelector(".rta-assign-popup")).toBeNull();
  click(trigger);
  await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  expect(document.querySelector(".rta-assign-popup")).toBeNull();
  click(trigger);
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await Promise.resolve(); });
  expect(document.querySelector(".rta-assign-popup")).toBeNull();
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });
  expect(document.activeElement).toBe(trigger);
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["get_plan_month", "get_hidden_categories"]);
});

it("prevents stale writes and duplicate submissions while the backend call is pending", async () => {
  await mount();
  click(host.querySelector(".plan-rta-assign")!);
  change(document.querySelector<HTMLSelectElement>('[aria-label="Assign to category"]')!, "rent");
  const form = document.querySelector<HTMLFormElement>(".rta-assign-scroll")!;
  let release!: () => void;
  vi.mocked(invoke).mockImplementation((async (command) => command === "assign_ready_to_assign" ? await new Promise<void>((resolve) => { release = resolve; }) : command === "get_plan_month" ? snapshot() : undefined) as typeof invoke);
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  expect(assignmentCalls()).toBe(1);
  expect((document.querySelector(".rta-actions button[type=submit]") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { release(); await Promise.resolve(); });
});

it("surfaces a failed assignment and never repeats its write", async () => {
  await mount();
  click(host.querySelector(".plan-rta-assign")!);
  change(document.querySelector<HTMLSelectElement>('[aria-label="Assign to category"]')!, "rent");
  vi.mocked(invoke).mockImplementation(async (command) => { if (command === "assign_ready_to_assign") throw new Error("backend rejected"); return undefined; });
  await act(async () => { document.querySelector(".rta-assign-scroll")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); });
  expect(host.querySelector(".editor-error")?.textContent).toContain("Could not assign money");
  expect(assignmentCalls()).toBe(1);
});
