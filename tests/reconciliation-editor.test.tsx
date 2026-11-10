// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReconciliationEditor } from "../src/app/ReconciliationEditor";
import type { AccountOverview } from "../src/lib/desktop";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => tauri);

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
beforeEach(() => { vi.clearAllMocks(); tauri.isTauri.mockReturnValue(true); });

const cash: AccountOverview = {
  id: "cash", name: "Cash", kind: "cash", sortOrder: 0, closed: false,
  balance: { working: "0", cleared: "0", uncleared: "0", reconciled: "0" },
};
const review = (adjustmentAmount: string) => ({ accountId: "cash", asOf: "2026-10-02", appClearedBalance: "5000", bankClearedBalance: "5000", adjustmentAmount, clearedEntryCount: 3 });

async function enterBalance(onSaved: () => Promise<void>, onCancel: () => void) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(<ReconciliationEditor account={cash} onSaved={onSaved} onCancel={onCancel} />); });
  const input = host.querySelector<HTMLInputElement>('input[placeholder="e.g. -12 500"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, "5000"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
}

it("reconciles immediately when the entered balance matches Allocash", async () => {
  tauri.invoke.mockImplementation(async (command: string) => {
    if (command === "get_account_register") return [];
    if (command === "preview_account_reconciliation") return review("0");
    if (command === "reconcile_account") return { review: review("0"), reconciledEntryCount: 3, adjustmentTransactionId: null };
    throw new Error(`unexpected ${command}`);
  });
  const onSaved = vi.fn(async () => {}); const onCancel = vi.fn();
  await enterBalance(onSaved, onCancel);
  expect(tauri.invoke).toHaveBeenCalledWith("reconcile_account", { input: expect.objectContaining({ bankClearedBalance: "5000", expectedClearedBalance: "5000" }) });
  expect(onSaved).toHaveBeenCalledOnce(); expect(onCancel).toHaveBeenCalledOnce();
});

it("shows the review without reconciling when the balance does not match", async () => {
  tauri.invoke.mockImplementation(async (command: string) => {
    if (command === "get_account_register") return [];
    if (command === "preview_account_reconciliation") return review("-200");
    throw new Error(`unexpected ${command}`);
  });
  const onSaved = vi.fn(async () => {}); const onCancel = vi.fn();
  await enterBalance(onSaved, onCancel);
  expect(tauri.invoke).not.toHaveBeenCalledWith("reconcile_account", expect.anything());
  expect(onCancel).not.toHaveBeenCalled();
  expect(host.querySelector(".reconciliation-review")).not.toBeNull();
});
