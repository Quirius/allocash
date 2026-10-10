// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { AmountInput } from "../src/app/AmountInput";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

function mount(original = "3000", readOnly = false) {
  const saves: string[] = [];
  function Editor() {
    const [value, setValue] = useState(original);
    const current = useRef(original);
    return <AmountInput value={value} readOnly={readOnly} onChange={(event) => { current.current = event.target.value; setValue(event.target.value); }} onBlur={() => { if (current.current !== original) saves.push(current.current); }} />;
  }
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host); act(() => root.render(<Editor />));
  const input = host.querySelector("input")!;
  act(() => input.focus());
  return { input, saves };
}
function key(input: HTMLInputElement, value: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
  act(() => input.dispatchEvent(event));
  return event;
}
function typeValue(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("selects the full amount on focus and click so a plain number replaces it", () => {
  const { input, saves } = mount();
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
  input.setSelectionRange(2, 2); act(() => input.click());
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
  expect(key(input, "4").defaultPrevented).toBe(false);
  typeValue(input, "4500"); act(() => input.blur());
  expect(saves).toEqual(["4500"]);
});
it.each([["+", "3000+3000", "6000"], ["-", "3000-1000", "2000"], ["*", "3000*2", "6000"], ["/", "3000/2", "1500"]])("applies selected amount with %s and commits the evaluated value before blur saves", (operator, expression, expected) => {
  const { input, saves } = mount();
  expect(key(input, operator, operator === "+" || operator === "*").defaultPrevented).toBe(true);
  expect(input.value).toBe(`3000${operator}`);
  expect(input.selectionStart).toBe(input.value.length);
  typeValue(input, expression); act(() => input.blur());
  expect(input.value).toBe(expected);
  expect(saves).toEqual([expected]);
});
it("commits an expression with Enter and restores the previous amount with Escape", () => {
  const { input, saves } = mount();
  typeValue(input, "3000+3000"); key(input, "Escape");
  expect(input.value).toBe("3000"); expect(saves).toEqual([]);
  act(() => input.focus()); typeValue(input, "3000+3000"); key(input, "Enter");
  expect(saves).toEqual(["6000"]);
});
it("allows Tab navigation and commits on its resulting blur", () => {
  const { input, saves } = mount(); typeValue(input, "3000/2");
  expect(key(input, "Tab").defaultPrevented).toBe(false);
  act(() => input.blur()); expect(saves).toEqual(["1500"]);
});
it("leaves invalid drafts for validation and does not intercept partial selections or read-only fields", () => {
  const { input, saves } = mount();
  input.setSelectionRange(1, 2); expect(key(input, "+", true).defaultPrevented).toBe(false);
  expect(input.value).toBe("3000");
  typeValue(input, "3000/0"); act(() => input.blur());
  expect(input.value).toBe("3000/0"); expect(saves).toEqual(["3000/0"]);
  act(() => root.unmount()); host.remove();
  const second = mount("3000", true);
  expect(key(second.input, "*", true).defaultPrevented).toBe(false);
  expect(second.input.value).toBe("3000"); expect(second.saves).toEqual([]);
});
