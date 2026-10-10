// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CategoryNameEditor } from "../src/app/CategoryNameEditor";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
function mount(onRename = vi.fn(async (_id: string, _name: string) => {})) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<CategoryNameEditor categoryId="rent" name="Rent" busy={false} onRename={onRename} />));
  act(() => host.querySelector("button")!.click());
  return { input: host.querySelector("input")!, onRename };
}
function typeName(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }

it("selects the name and saves the trimmed replacement for the existing category ID", async () => {
  const { input, onRename } = mount();
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
  typeName(input, "  Housing  "); await submit();
  expect(onRename).toHaveBeenCalledExactlyOnceWith("rent", "Housing");
  expect(host.querySelector("input")).toBeNull();
  expect(document.activeElement).toBe(host.querySelector("button"));
});
it("cancels through Escape without saving and restores focus", () => {
  const { input, onRename } = mount(); typeName(input, "Unsaved");
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(onRename).not.toHaveBeenCalled(); expect(host.querySelector("input")).toBeNull();
  expect(document.activeElement).toBe(host.querySelector("button"));
  act(() => host.querySelector("button")!.click());
  expect(host.querySelector("input")!.value).toBe("Rent");
});
it("keeps a failed draft for retry and rejects blank names without calling storage", async () => {
  const onRename = vi.fn(async (_id: string, _name: string) => { throw new Error("Unavailable"); });
  const { input } = mount(onRename); typeName(input, "Housing"); await submit();
  expect(host.querySelector("input")!.value).toBe("Housing");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not rename");
  typeName(input, "   "); await submit(); expect(onRename).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Enter a category name");
});
it("prevents duplicate writes and cancellation while a rename is saving", async () => {
  let finish!: () => void;
  const onRename = vi.fn((_id: string, _name: string) => new Promise<void>((resolve) => { finish = resolve; }));
  const { input } = mount(onRename); typeName(input, "Housing"); await submit(); await submit();
  expect(onRename).toHaveBeenCalledTimes(1); expect(input.disabled).toBe(true);
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(host.querySelector("input")).toBe(input);
  await act(async () => finish()); expect(host.querySelector("input")).toBeNull();
});
it("counts Unicode characters consistently with storage", async () => {
  const { input, onRename } = mount();
  typeName(input, "🏠".repeat(201)); await submit(); expect(onRename).not.toHaveBeenCalled();
  typeName(input, "🏠".repeat(200)); await submit();
  expect(onRename).toHaveBeenCalledExactlyOnceWith("rent", "🏠".repeat(200));
});
