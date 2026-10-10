// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AccountEditor } from "../src/app/AccountEditor";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
const account = (overrides: Partial<{ accountId: string; name: string; notes: string; closed: boolean; workingBalance: string; transactionCount: number; transferCount: number; scheduleCount: number; reconciledCount: number }> = {}) => ({ accountId: "cash", name: "Everyday", notes: "Original", closed: false, workingBalance: "12000", transactionCount: 0, transferCount: 0, scheduleCount: 0, reconciledCount: 0, ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_account_details" ? account() : undefined);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

function mount(onChanged = vi.fn(async () => {})) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  const onClose = vi.fn();
  act(() => root.render(<AccountEditor accountId="cash" pending={false} onChanged={onChanged} onClose={onClose} />));
  return { onChanged, onClose };
}
function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function settle() { await act(async () => { await Promise.resolve(); }); }
function button(name: string) { return [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === name)!; }

it("saves trimmed nickname, exact notes and calculated working balance through the account IPC", async () => {
  mount(); await settle();
  setValue(host.querySelector("input")!, "  Wallet  ");
  setValue(host.querySelector("textarea")!, "  Keep these notes\n  ");
  const balance = host.querySelector(".account-working-balance input") as HTMLInputElement;
  setValue(balance, "12000+3000");
  await act(async () => button("Save").click());
  expect(invoke).toHaveBeenCalledWith("edit_account", { input: {
    accountId: "cash", name: "Wallet", notes: "  Keep these notes\n  ",
    asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expectedWorkingBalance: "12000", workingBalance: "15000",
  } });
});

it("keeps closed account history visible and disables deletion while entries remain", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_account_details" ? account({ closed: true, transactionCount: 2, transferCount: 1 }) : undefined);
  mount(); await settle();
  expect(host.querySelector(".account-working-balance")).toBeNull();
  expect(host.textContent).toContain("Delete all 2 transactions");
  expect(button("Delete").disabled).toBe(true);
  expect(invoke).not.toHaveBeenCalledWith("delete_closed_account", expect.anything());
});

it("requires an explicit confirmation before deleting an empty closed account", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_account_details" ? account({ closed: true }) : undefined);
  mount(); await settle();
  await act(async () => button("Delete").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Delete Everyday?");
  expect(invoke).not.toHaveBeenCalledWith("delete_closed_account", expect.anything());
  await act(async () => button("Delete account").click());
  const deletes = vi.mocked(invoke).mock.calls.filter(([command]) => command === "delete_closed_account");
  expect(deletes).toEqual([["delete_closed_account", { input: { accountId: "cash", confirmed: true } }]]);
});

it("cancels the delete confirmation without a mutation", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_account_details" ? account({ closed: true }) : undefined);
  mount(); await settle();
  await act(async () => button("Delete").click());
  await act(async () => button("Keep account").click());
  expect(host.querySelector(".account-delete-confirm")).toBeNull();
  expect(invoke).not.toHaveBeenCalledWith("delete_closed_account", expect.anything());
  expect(invoke).not.toHaveBeenCalledWith("edit_account", expect.anything());
  expect(invoke).not.toHaveBeenCalledWith("set_account_closed", expect.anything());
});

it("reopens a closed account through the typed state-change command", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => command === "get_account_details" ? account({ closed: true }) : undefined);
  mount(); await settle();
  await act(async () => button("Re-open").click());
  expect(invoke).toHaveBeenCalledWith("set_account_closed", { input: { id: "cash", closed: false } });
});

it("retries a failed list refresh without repeating the saved account edit", async () => {
  const onChanged = vi.fn().mockRejectedValueOnce(new Error("refresh unavailable")).mockResolvedValueOnce(undefined);
  const { onClose } = mount(onChanged); await settle();
  setValue(host.querySelector("input")!, "Wallet");
  await act(async () => button("Save").click());
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "edit_account")).toHaveLength(1);
  expect(host.textContent).toContain("Changes were saved, but the account list could not refresh");
  await act(async () => button("Retry refresh").click());
  expect(onChanged).toHaveBeenCalledTimes(2);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "edit_account")).toHaveLength(1);
  expect(onClose).toHaveBeenCalledOnce();
});
