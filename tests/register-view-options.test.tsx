// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_REGISTER_VIEW_OPTIONS } from "../src/app/register-view";
import { RegisterViewOptionsPopup } from "../src/app/RegisterViewOptions";
import type { ComponentProps } from "react";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

async function mount(props: Partial<ComponentProps<typeof RegisterViewOptionsPopup>> = {}) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onApply = vi.fn(); const onClose = vi.fn(); const onResetWidths = vi.fn();
  await act(async () => { root!.render(<RegisterViewOptionsPopup value={{ ...DEFAULT_REGISTER_VIEW_OPTIONS, datePreset: "AllDates", customFromMonth: "2022-01", customToMonth: "2026-10" }} allAccounts={false} earliestMonth="2022-01" latestMonth="2026-10" onApply={onApply} onClose={onClose} onResetWidths={onResetWidths} {...props} />); });
  return { onApply, onClose, onResetWidths };
}

it("discards draft changes on Cancel and Escape", async () => {
  const { onApply, onClose } = await mount();
  await act(async () => { host!.querySelector<HTMLButtonElement>(".register-view-presets button:first-child")!.click(); });
  await act(async () => { host!.querySelector<HTMLButtonElement>("footer button:nth-last-child(3)")!.click(); });
  expect(onApply).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("applies custom month and year controls, exposes flags and running balance, and resets columns", async () => {
  const { onApply, onResetWidths } = await mount();
  expect(host!.querySelector('select[aria-label="From year"]')).not.toBeNull();
  expect(host!.querySelector('select[aria-label="To month"]')).not.toBeNull();
  expect([...host!.querySelectorAll("label")].some((label) => label.textContent?.includes("Show Reconciled Transactions"))).toBe(true);
  await act(async () => { host!.querySelector<HTMLButtonElement>("footer button:last-child")!.click(); });
  expect(onResetWidths).toHaveBeenCalledOnce();
  await act(async () => { host!.querySelector<HTMLButtonElement>(".register-view-presets button:nth-child(2)")!.click(); });
  await act(async () => { host!.querySelector<HTMLButtonElement>("footer .apply")!.click(); });
  const previous = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const previousKey = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ datePreset: "LastMonth", customFromMonth: previousKey, customToMonth: previousKey }));
});

it("omits the running balance option in All Accounts", async () => {
  await mount({ allAccounts: true });
  expect(host!.textContent).not.toContain("Show Running Balance");
});

it("keeps January selectable for This Year and includes Last Year on a fresh register", async () => {
  await mount({ earliestMonth: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`, latestMonth: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}` });
  await act(async () => { host!.querySelector<HTMLButtonElement>(".register-view-presets button:nth-child(4)")!.click(); });
  expect(host!.querySelector<HTMLSelectElement>('select[aria-label="From month"]')!.value).toBe("01");
  const priorYear = String(new Date().getFullYear() - 1);
  expect([...host!.querySelector<HTMLSelectElement>('select[aria-label="From year"]')!.options].map((option) => option.value)).toContain(priorYear);
  await act(async () => { host!.querySelector<HTMLButtonElement>(".register-view-presets button:nth-child(5)")!.click(); });
  expect(host!.querySelector<HTMLSelectElement>('select[aria-label="From year"]')!.value).toBe(priorYear);
});
