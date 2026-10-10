// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TransactionContextMenu } from "../src/app/TransactionContextMenu";
import { TransactionStatusIcon } from "../src/app/TransactionStatusIcon";
import type { RegisterEntry } from "../src/lib/desktop";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.useRealTimers(); });

const entry = (overrides: Partial<RegisterEntry> = {}): RegisterEntry => ({
  id: "entry", date: "2026-10-09", payeeName: "Shop", categoryId: null, categoryGroupName: null,
  categoryName: null, memo: "", flagId: null, flagName: null, flagColor: null, clearedState: "uncleared",
  postingState: "posted", origin: "manual", amount: "-10", transferId: null, transferAccountName: null, ...overrides,
});
function mount(value = entry()) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const callbacks = { onClose: vi.fn(), onEdit: vi.fn(), onDuplicate: vi.fn(), onMakeRepeating: vi.fn(), onDelete: vi.fn(), onStatusChange: vi.fn(), onEditMemo: vi.fn() };
  act(() => root.render(<><button id="origin">Open</button><TransactionContextMenu entry={value} x={40} y={40} {...callbacks} /></>));
  return callbacks;
}

it("routes the status toggle and skips disabled commands during keyboard navigation", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12));
  const callbacks = mount();
  const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
  const status = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((item) => item.textContent?.includes("Mark as Cleared"))!;
  expect(status.disabled).toBe(false);
  const first = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((item) => item.textContent?.includes("Edit"))!;
  act(() => first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement).toBe(status);
  act(() => status.click());
  expect(callbacks.onStatusChange).toHaveBeenCalledWith("cleared");
});

it("locks reconciled and pending status changes and omits the pending status icon", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12));
  mount(entry({ clearedState: "reconciled" }));
  const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
  expect([...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((item) => item.textContent?.includes("Mark as Cleared"))?.disabled).toBe(true);
  act(() => root.render(<TransactionStatusIcon state="reconciled" onToggle={vi.fn()} />));
  expect(host.querySelector("button.transaction-status-icon")).toBeNull();
  expect(host.querySelector('[aria-label="Reconciled"]')).not.toBeNull();
  act(() => root.render(<TransactionStatusIcon state="uncleared" pending />));
  expect(host.querySelector(".transaction-status-icon")).toBeNull();
});

it("disables both status choices for scheduled and future entries", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12));
  mount(entry({ postingState: "scheduled", date: "2026-10-11" }));
  const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
  for (const label of ["Mark as Cleared", "Mark as Uncleared"]) {
    expect([...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((item) => item.textContent?.includes(label))?.disabled).toBe(true);
  }
});

it("clamps the menu to the viewport using its measured dimensions", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 216, bottom: 180, width: 216, height: 180, x: 0, y: 0, toJSON: () => ({}) });
  const callbacks = { onClose: vi.fn(), onEdit: vi.fn(), onDuplicate: vi.fn(), onMakeRepeating: vi.fn(), onDelete: vi.fn(), onStatusChange: vi.fn() };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(<TransactionContextMenu entry={entry()} x={290} y={290} {...callbacks} />));
  const menu = document.body.querySelector<HTMLElement>(".transaction-context-menu")!;
  expect(menu.style.left).toBe("76px"); expect(menu.style.top).toBe("112px");
});

it("closes on Escape and restores focus to the previously active element", () => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const callbacks = { onClose: vi.fn(), onEdit: vi.fn(), onDuplicate: vi.fn(), onMakeRepeating: vi.fn(), onDelete: vi.fn(), onStatusChange: vi.fn() };
  const prior = document.createElement("button"); document.body.append(prior); prior.focus();
  act(() => root.render(<TransactionContextMenu entry={entry()} x={20} y={20} {...callbacks} />));
  const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
  act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(callbacks.onClose).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(prior);
  prior.remove();
});

it("runs displayed letter and Delete shortcuts while the menu has focus", () => {
  const callbacks = mount();
  const menu = document.body.querySelector<HTMLElement>("[role=menu]")!;
  act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "d", shiftKey: true, bubbles: true })));
  expect(callbacks.onDuplicate).toHaveBeenCalledOnce();
  act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "t", shiftKey: true, bubbles: true })));
  expect(callbacks.onMakeRepeating).toHaveBeenCalledOnce();
  act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true })));
  expect(callbacks.onEdit).toHaveBeenCalledOnce();
  act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
  expect(callbacks.onDelete).toHaveBeenCalledOnce();
});

it("blocks repeating a future cleared non-transfer but allows a future cleared transfer", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12));
  mount(entry({ date: "2026-10-11", clearedState: "cleared" }));
  const firstMenu = document.body.querySelector<HTMLElement>("[role=menu]")!;
  expect([...firstMenu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((item) => item.textContent?.includes("Make Repeating"))?.disabled).toBe(true);
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(<TransactionContextMenu entry={entry({ date: "2026-10-11", clearedState: "cleared", transferId: "transfer" })} x={30} y={30} onClose={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onMakeRepeating={vi.fn()} onDelete={vi.fn()} onStatusChange={vi.fn()} />));
  const secondMenu = document.body.querySelector<HTMLElement>("[role=menu]")!;
  expect([...secondMenu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((item) => item.textContent?.includes("Make Repeating"))?.disabled).toBe(false);
});
