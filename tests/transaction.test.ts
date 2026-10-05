import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createPayeeEntry } from "../src/lib/transaction";
import type { AccountOverview, ManualTransactionInput } from "../src/lib/desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(invoke).mockResolvedValue("entry-id"); });

const cash: AccountOverview = {
  id: "cash", name: "Cash", kind: "cash", closed: false, sortOrder: 0,
  balance: { working: "0", cleared: "0", uncleared: "0", reconciled: "0" },
};
const accounts = [cash, { ...cash, id: "bank", name: "Bank" }];
const draft: ManualTransactionInput = {
  accountId: "bank", date: "2026-10-05", payeeName: "Transfer: Cash",
  categoryId: "food", memo: "Test transfer", flagId: null, amount: "-1000",
};

it.each(["Transfer: Cash", " transfer: cash ", "Payment: Cash"])("creates a linked transfer for payee %s", async (payeeName) => {
  await expect(createPayeeEntry({ ...draft, payeeName }, accounts)).resolves.toBe("entry-id");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_manual_transfer", { input: {
    accountId: "bank", counterpartAccountId: "cash", date: "2026-10-05",
    memo: "Test transfer", flagId: null, amount: "1000", direction: "outflow",
  } });
});

it("creates the inflow side without losing integer precision", async () => {
  await createPayeeEntry({ ...draft, amount: "9007199254740993" }, accounts);
  expect(invoke).toHaveBeenCalledWith("create_manual_transfer", { input: expect.objectContaining({
    amount: "9007199254740993", direction: "inflow", counterpartAccountId: "cash",
  }) });
});

it.each(["Transfer:", "Transfer: Ca", "Transfer: Missing", "Transfer: Bank"])("rejects unresolved or same-account payee %s without writing", async (payeeName) => {
  await expect(createPayeeEntry({ ...draft, payeeName }, accounts)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("refuses closed or ambiguous destination accounts", async () => {
  await expect(createPayeeEntry(draft, [{ ...cash, closed: true }])).rejects.toThrow("closed");
  await expect(createPayeeEntry(draft, [cash, { ...cash, id: "duplicate" }])).rejects.toThrow("exact transfer account");
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps ordinary payees and their categories unchanged", async () => {
  const ordinary = { ...draft, payeeName: "Shop" };
  await createPayeeEntry(ordinary, accounts);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_manual_transaction", { input: ordinary });
});
