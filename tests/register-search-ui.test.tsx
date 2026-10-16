// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RegisterSearch } from "../src/app/RegisterSearch";
import type { ComponentProps } from "react";
import type { SearchSuggestion } from "../src/app/register-search";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });

const suggestions: SearchSuggestion[] = [
  { key: "payee", label: "Payee: Market", fieldLabel: "Payee", filter: { kind: "payee", query: "Market" } },
  { key: "account", label: "Daily account", fieldLabel: "Account", filter: { kind: "account", id: "a1", label: "Daily account" } },
];

async function mount(overrides: Partial<ComponentProps<typeof RegisterSearch>> = {}) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onChange = vi.fn(); const onSelect = vi.fn();
  await act(async () => root!.render(<RegisterSearch value="Market" onChange={onChange} filter={{ kind: "any", query: "Market" }} onSelect={onSelect} suggestions={suggestions} disabled={false} placeholder="Search register" {...overrides} />));
  return { onChange, onSelect, input: host.querySelector<HTMLInputElement>("[role=combobox]")! };
}

it("exposes an accessible combobox and selects the active suggestion by keyboard", async () => {
  const { input, onSelect } = await mount();
  expect(input.getAttribute("aria-label")).toBe("Search register");
  expect(input.getAttribute("aria-autocomplete")).toBe("list");
  expect(input.getAttribute("aria-expanded")).toBe("false");
  await act(async () => { input.focus(); });
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect(host!.querySelectorAll('[role="option"]')).toHaveLength(2);
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  expect(input.getAttribute("aria-activedescendant")).toMatch(/option-0$/);
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(onSelect).toHaveBeenCalledWith(suggestions[1]!.filter);
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

it("uses generic search on Enter without an active option and resets on clear", async () => {
  const { input, onChange, onSelect } = await mount();
  await act(async () => { input.focus(); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(onSelect).toHaveBeenCalledWith({ kind: "any", query: "Market" });
  await act(async () => { host!.querySelector<HTMLButtonElement>("[aria-label='Clear search']")!.click(); });
  expect(onChange).toHaveBeenCalledWith("");
  expect(onSelect).toHaveBeenLastCalledWith({ kind: "any", query: "" });
});

it("preserves an exact filter when Enter follows dismissal", async () => {
  const exactFilter = { kind: "category-id", id: "c1", label: "Food / Market" } as const;
  const { input, onSelect } = await mount({ filter: exactFilter });
  await act(async () => { input.focus(); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(onSelect).toHaveBeenLastCalledWith(exactFilter);
});

it("preserves a field filter when Enter has no active suggestion", async () => {
  const memoFilter = { kind: "memo", query: "Market" } as const;
  const { input, onSelect } = await mount({ filter: memoFilter });
  await act(async () => { input.focus(); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(onSelect).toHaveBeenLastCalledWith(memoFilter);
});

it("labels an exact category-group selection as Category", async () => {
  await mount({ filter: { kind: "category-group", id: "Food", label: "Food" } });
  expect(host!.querySelector(".register-search-filter")?.textContent).toBe("Category: Food");
});

it("dismisses with Escape without clearing and selects by mouse", async () => {
  const { input, onChange, onSelect } = await mount();
  await act(async () => { input.focus(); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => { input.blur(); });
  await act(async () => { input.focus(); });
  await act(async () => { host!.querySelector<HTMLElement>("[role='option']")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
  await act(async () => { host!.querySelector<HTMLElement>("[role='option']")!.click(); });
  expect(onSelect).toHaveBeenCalledWith(suggestions[0]!.filter);
});

it("keeps suggestions mounted through a touch blur until the tap selects", async () => {
  const { input, onSelect } = await mount();
  await act(async () => { input.focus(); });
  const option = host!.querySelector<HTMLElement>("[role='option']")!;
  const pointerDown = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(pointerDown, "pointerType", { value: "touch" });
  await act(async () => { option.dispatchEvent(pointerDown); input.blur(); });
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect(host!.querySelector("[role='option']")).not.toBeNull();
  const pointerUp = new Event("pointerup", { bubbles: true });
  Object.defineProperty(pointerUp, "pointerType", { value: "touch" });
  await act(async () => { document.dispatchEvent(pointerUp); option.click(); });
  expect(onSelect).toHaveBeenCalledWith(suggestions[0]!.filter);
});

it("closes on outside pointerdown and stays closed when disabled", async () => {
  const { input } = await mount();
  await act(async () => { input.focus(); });
  const outside = document.createElement("button"); document.body.append(outside);
  await act(async () => { outside.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  outside.remove();
  await act(async () => root!.render(<RegisterSearch value="Market" onChange={vi.fn()} filter={{ kind: "any", query: "Market" }} onSelect={vi.fn()} suggestions={suggestions} disabled placeholder="Search register" />));
  expect(input.disabled).toBe(true);
  expect(host!.querySelector("[role='listbox']")).toBeNull();
  expect(host!.querySelector<HTMLButtonElement>("[aria-label='Clear search']")!.disabled).toBe(true);
});
