import { expect, it } from "vitest";
import { reconciliationCandidates } from "../src/app/ReconciliationEditor";
import type { RegisterEntry } from "../src/lib/desktop";

function entry(id: string, overrides: Partial<RegisterEntry> = {}): RegisterEntry {
  return {
    id,
    date: "2026-09-10",
    payeeName: "Market",
    categoryGroupName: "Living",
    categoryName: "Groceries",
    memo: "",
    flagName: null,
    flagColor: null,
    clearedState: "uncleared",
    postingState: "posted",
    origin: "manual",
    amount: "-1000",
    transferId: null,
    transferAccountName: null,
    ...overrides,
  };
}

it("offers only posted unreconciled rows through the reconciliation date", () => {
  const candidates = reconciliationCandidates([
    entry("uncleared"),
    entry("cleared", { clearedState: "cleared" }),
    entry("transfer-leg", { transferId: "transfer", transferAccountName: "Card" }),
    entry("reconciled", { clearedState: "reconciled" }),
    entry("scheduled", { postingState: "scheduled" }),
    entry("future", { date: "2026-09-11" }),
  ], "2026-09-10");

  expect(candidates.map((candidate) => candidate.id)).toEqual(["uncleared", "cleared", "transfer-leg"]);
});
