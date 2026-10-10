// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanMonthPicker } from "../src/app/PlanMonthPicker";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const onMonthChange = vi.fn();

beforeEach(() => {
  onMonthChange.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(<PlanMonthPicker month="2026-10" onMonthChange={onMonthChange} />));
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); document.querySelector(".plan-month-popup")?.remove(); });

function open() { act(() => host.querySelector<HTMLButtonElement>(".plan-month-trigger")!.click()); }

it("browses years without selecting or loading a month, then selects one month", () => {
  open();
  expect(document.querySelector(".plan-month-popup")?.textContent).toContain("2026");
  expect(document.querySelectorAll(".plan-month-grid button")).toHaveLength(12);
  expect(document.querySelector('.plan-month-grid button[aria-pressed="true"]')?.textContent).toBe("Oct");
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Next year"]')!.click());
  expect(document.querySelector(".plan-month-year strong")?.textContent).toBe("2027");
  expect(document.querySelector('.plan-month-grid button[aria-pressed="true"]')).toBeNull();
  expect(onMonthChange).not.toHaveBeenCalled();
  act(() => document.querySelector<HTMLButtonElement>(".plan-month-grid button:nth-child(3)")!.click());
  expect(onMonthChange).toHaveBeenCalledWith("2027-03");
  expect(document.querySelector(".plan-month-popup")).toBeNull();
  expect(document.activeElement).toBe(host.querySelector(".plan-month-trigger"));
});

it("closes on Escape and outside pointer, restoring focus for Escape", () => {
  open();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector(".plan-month-popup")).toBeNull();
  expect(document.activeElement).toBe(host.querySelector(".plan-month-trigger"));
  open();
  act(() => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(document.querySelector(".plan-month-popup")).toBeNull();
  expect(onMonthChange).not.toHaveBeenCalled();
});

it("keeps year browsing inside years 0001 through 9999", () => {
  act(() => root.render(<PlanMonthPicker month="0001-01" onMonthChange={onMonthChange} />));
  open();
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Previous year"]')?.disabled).toBe(true);
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Next year"]')!.click());
  expect(document.querySelector(".plan-month-year strong")?.textContent).toBe("2");
  act(() => host.querySelector<HTMLButtonElement>(".plan-month-trigger")!.click());
  act(() => root.render(<PlanMonthPicker month="9999-12" onMonthChange={onMonthChange} />));
  act(() => host.querySelector<HTMLButtonElement>(".plan-month-trigger")!.click());
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Next year"]')?.disabled).toBe(true);
});
