// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DateRepeatPicker } from "../src/app/DateRepeatPicker";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

it("keeps the portaled picker open for inside clicks and closes it on outside pointerdown without writes", () => {
  const onDateChange = vi.fn();
  const onRepeatChange = vi.fn();
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<DateRepeatPicker date="2026-10-15" onDateChange={onDateChange} repeat="never" onRepeatChange={onRepeatChange} />));

  act(() => host.querySelector<HTMLButtonElement>(".date-picker-trigger")!.click());
  const popover = document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Choose date and repeat"]')!;
  expect(popover).not.toBeNull();
  expect(host.contains(popover)).toBe(false);

  act(() => {
    popover.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    popover.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.click();
  });
  expect(document.body.querySelector('[role="dialog"][aria-label="Choose date and repeat"]')).not.toBeNull();
  expect(onDateChange).not.toHaveBeenCalled();
  expect(onRepeatChange).not.toHaveBeenCalled();

  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.body.querySelector('[role="dialog"][aria-label="Choose date and repeat"]')).toBeNull();
  expect(onDateChange).not.toHaveBeenCalled();
  expect(onRepeatChange).not.toHaveBeenCalled();
});
