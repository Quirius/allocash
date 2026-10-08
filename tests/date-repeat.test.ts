import { expect, it, vi } from "vitest";
import type { AccountOverview, RegisterEntry } from "../src/lib/desktop";
import { draftFromPostedEntry, signedAmount } from "../src/app/TransactionEditor";
import { nextCalendarMonth } from "../src/app/DateRepeatPicker";

const baseEntry: RegisterEntry = {
  id: "source", date: "2026-01-31", payeeName: "Rent", categoryId: "hidden-category",
  categoryGroupName: "Housing", categoryName: "Rent", memo: "monthly note", flagId: "flag-1",
  flagName: "Check", flagColor: "yellow", clearedState: "reconciled", postingState: "posted",
  origin: "manual", amount: "9223372036854775807", transferId: null, transferAccountName: null,
};
const accounts = [
  { id: "source-account", name: "Bank" }, { id: "cash-account", name: "Cash" },
] as AccountOverview[];

it.each([
  ["2026-01-31", "2026-02-28"], ["2024-01-31", "2024-02-29"],
  ["2026-12-31", "2027-01-31"], ["0001-12-31", "0002-01-31"],
])("advances %s by one calendar month with clamping", (source, expected) => {
  expect(nextCalendarMonth(source)).toBe(expected);
});

it("copies a large inflow into a monthly draft with source details", () => {
  const draft = draftFromPostedEntry({ ...baseEntry, amount: "9223372036854775807" }, "source-account", accounts);
  expect(draft).toEqual({
    kind: "transaction", date: "2026-02-28", repeat: "monthly", payee: "Rent",
    categoryId: "hidden-category", counterpartId: "", memo: "monthly note", flagId: "flag-1",
    outflow: "", inflow: "9223372036854775807",
  });
});

it("preserves the minimum signed HUF amount as an outflow draft", () => {
  const draft = draftFromPostedEntry({ ...baseEntry, amount: "-9223372036854775808" }, "source-account", accounts);
  expect(draft).toMatchObject({ outflow: "9223372036854775808", inflow: "" });
});

it("validates composer outflows including signed limits and zero", () => {
  expect(signedAmount("9223372036854775808", "").amount).toBe("-9223372036854775808");
  expect(signedAmount("9223372036854775807", "").amount).toBe("-9223372036854775807");
  expect(() => signedAmount("0", "")).toThrow("greater than zero");
  expect(() => signedAmount("-5", "")).toThrow();
  expect(() => signedAmount("10", "1")).toThrow("either an outflow or an inflow");
});

it("resolves a linked transfer destination only by its unique exact account name", () => {
  const draft = draftFromPostedEntry({ ...baseEntry, transferId: "pair", transferAccountName: "Cash", amount: "-5500", payeeName: null }, "source-account", accounts);
  expect(draft).toMatchObject({ kind: "transfer", date: "2026-02-28", repeat: "monthly", counterpartId: "cash-account", outflow: "5500", inflow: "" });
  expect(() => draftFromPostedEntry({ ...baseEntry, transferId: "pair", transferAccountName: "Cash" }, "source-account", [...accounts, { id: "another-cash", name: "Cash" } as AccountOverview])).toThrow("cannot be identified uniquely");
});

it("uses the linked account identity when account names are duplicated", () => {
  const source = { ...baseEntry, transferId: "pair", transferAccountId: "cash-account", transferAccountName: "Cash" };
  const draft = draftFromPostedEntry(source, "source-account", [...accounts, { id: "other-cash", name: "Cash" } as AccountOverview]);
  expect(draft.counterpartId).toBe("cash-account");
});

it("defaults a repeating draft to one month after the original date", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 8, 12));
  try {
    const source = Object.freeze({ ...baseEntry, date: "2023-01-31" });
    const draft = draftFromPostedEntry(source, "source-account", accounts);
    expect(draft).toMatchObject({ date: "2023-02-28", repeat: "monthly" });
    expect(source.date).toBe("2023-01-31");
    expect(source.clearedState).toBe("reconciled");
  } finally {
    vi.useRealTimers();
  }
});
