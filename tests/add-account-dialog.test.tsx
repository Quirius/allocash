// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddAccountDialog } from "../src/app/AddAccountDialog";
import { createBudgetAccount } from "../src/lib/desktop";

vi.mock("../src/lib/desktop", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/desktop")>(),
  createBudgetAccount: vi.fn(),
  hasSavedMutationPending: vi.fn(() => false),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createBudgetAccount).mockResolvedValue("new-account");
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

function mount(onCreated = vi.fn(async (_id: string) => {}), pending = false) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  const onClose = vi.fn();
  act(() => root.render(<AddAccountDialog pending={pending} onCreated={onCreated} onClose={onClose} />));
  return { onCreated, onClose };
}
function button(name: string) { return [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === name)!; }
function setValue(element: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function input(label: string) { return host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement; }
async function chooseType(label: string) {
  await act(async () => button("Choose account type").click());
  expect(host.querySelector(".add-account-type-picker")).not.toBeNull();
  await act(async () => button(label).click());
}
async function fillName(value = "My Account") { setValue(host.querySelector("input[required]:not([aria-label])")!, value); }
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

it.each([
  ["Checking", "cash"], ["Savings", "cash"], ["Cash", "cash"],
  ["Credit Card", "credit"], ["Line of Credit", "credit"],
  ["Mortgage", "loan"], ["Auto Loan", "loan"], ["Student Loan", "loan"], ["Personal Loan", "loan"], ["Medical Debt", "loan"], ["Other Debt", "loan"],
  ["Asset", "tracking"], ["Liability", "tracking"],
] as const)("offers %s and maps it to the current %s account kind", async (label, kind) => {
  mount();
  expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  await chooseType(label);
  await fillName();
  await submit();
  expect(createBudgetAccount).toHaveBeenCalledExactlyOnceWith({ name: "My Account", kind, balance: "0", asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
});

it("returns from the type picker and submits a signed calculated starting balance", async () => {
  const { onClose } = mount();
  await act(async () => button("Choose account type").click());
  await act(async () => button("Back").click());
  expect(host.querySelector(".add-account-type-picker")).toBeNull();
  setValue(input("Starting Balance"), "-2500+500");
  await chooseType("Credit Card");
  await fillName("  Card  ");
  await submit();
  expect(createBudgetAccount).toHaveBeenCalledExactlyOnceWith({ name: "Card", kind: "credit", balance: "-2000", asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  expect(onClose).toHaveBeenCalledOnce();
});

it("requires a nickname and type, accepts zero, and reports an invalid HUF expression", async () => {
  mount();
  expect(input("Starting Balance").value).toBe("0");
  expect(input("Starting Balance").required).toBe(true);
  await fillName("   ");
  await chooseType("Cash");
  await submit();
  expect(createBudgetAccount).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("nickname");
  await fillName();
  setValue(input("Starting Balance"), "4/0");
  await submit();
  expect(createBudgetAccount).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("whole HUF");
});

it("retries a failed list refresh without creating a second account", async () => {
  let finishRefresh!: () => void;
  const onCreated = vi.fn().mockRejectedValueOnce(new Error("refresh unavailable")).mockImplementationOnce(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
  const { onClose } = mount(onCreated);
  await chooseType("Savings"); await fillName(); await submit();
  expect(createBudgetAccount).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Account was created, but the account list could not refresh");
  await act(async () => { button("Retry refresh").click(); button("Retry refresh").click(); });
  expect(createBudgetAccount).toHaveBeenCalledOnce();
  expect(onCreated).toHaveBeenCalledTimes(2);
  expect(onCreated).toHaveBeenNthCalledWith(1, "new-account");
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finishRefresh());
  expect(onClose).toHaveBeenCalledOnce();
});

it("blocks duplicate submits and Escape while account creation is pending", async () => {
  let finish!: (id: string) => void;
  vi.mocked(createBudgetAccount).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { onClose } = mount();
  await chooseType("Checking"); await fillName();
  await act(async () => {
    const form = host.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(createBudgetAccount).toHaveBeenCalledOnce();
  const cancel = new Event("cancel", { bubbles: false, cancelable: true });
  act(() => host.querySelector("dialog")!.dispatchEvent(cancel));
  expect(cancel.defaultPrevented).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finish("new-account"));
  expect(onClose).toHaveBeenCalledOnce();
});
