import { describe, expect, it } from "vitest";
import type { AccountOverview, RegisterEntry, TransactionFormOptions } from "../src/lib/desktop";
import { buildRegisterSearchSuggestions, matchesRegisterSearchFilter } from "../src/app/register-search";

const account = (id: string, name: string): AccountOverview => ({
  id, name, kind: "cash", sortOrder: 0, closed: false,
  balance: { working: "0", cleared: "0", uncleared: "0", reconciled: "0" },
});

const entry = (overrides: Partial<RegisterEntry> = {}): RegisterEntry => ({
  id: "entry-1", date: "2026-10-12", payeeName: "Green Market", categoryId: "cat-food",
  categoryGroupName: "Daily", categoryName: "Groceries", memo: "weekly shop", flagId: "flag-check",
  flagName: "Check", flagColor: "#f0c000", clearedState: "uncleared", postingState: "posted",
  origin: "manual", amount: "-12500", transferId: null, transferAccountName: null, ...overrides,
});

const options: TransactionFormOptions = {
  payees: [],
  categories: [
    { id: "cat-food", groupName: "Daily", name: "Groceries" },
    { id: "cat-other-food", groupName: "Business", name: "Groceries" },
    { id: "cat-inflow", groupName: "Income", name: "Inflow" },
  ],
  flags: [{ id: "flag-check", name: "Check", color: "#f0c000" }],
};

describe("register search suggestions", () => {
  it("matches account, category, and flag names by all case-insensitive whitespace terms", () => {
    const suggestions = buildRegisterSearchSuggestions("  GRO daily ", [account("cash-1", "Daily Groceries")], options, [entry()], true);
    expect(suggestions.map((suggestion) => suggestion.key)).toContain("account:cash-1");
    expect(suggestions.map((suggestion) => suggestion.key)).toContain("category:cat-food");
    expect(suggestions.map((suggestion) => suggestion.key)).not.toContain("category:cat-other-food");
    expect(suggestions.filter((suggestion) => suggestion.key.startsWith("find:")).map((suggestion) => suggestion.label)).toEqual([
      'Find “GRO daily” in any field', 'Find “GRO daily” in the Payee', 'Find “GRO daily” in the Category', 'Find “GRO daily” in the Memo',
    ]);
    expect(buildRegisterSearchSuggestions("", [], options, [], true)).toEqual([]);
  });

  it("offers every category identity, including inflow and historical categories, without label collisions", () => {
    const suggestions = buildRegisterSearchSuggestions("groceries", [], options, [entry({
      categoryId: "cat-legacy", categoryGroupName: "Archive", categoryName: "Groceries",
    })], false);
    const categories = suggestions.filter((suggestion) => suggestion.filter.kind === "category-id");
    expect(categories.map((suggestion) => suggestion.key)).toEqual(["category:cat-food", "category:cat-other-food", "category:cat-legacy"]);
    expect(categories.map((suggestion) => suggestion.label)).toEqual(["Daily / Groceries", "Business / Groceries", "Archive / Groceries"]);

    const all = buildRegisterSearchSuggestions("inflow", [], options, [], false);
    expect(all.map((suggestion) => suggestion.key)).toContain("category:cat-inflow");
    const groupMatches = buildRegisterSearchSuggestions("daily", [], options, [entry()], false);
    expect(groupMatches.map((suggestion) => suggestion.key)).toContain("category-group:Daily");
    expect(groupMatches.find((suggestion) => suggestion.key === "category-group:Daily")?.label).toBe("Daily");
  });

  it("limits account suggestions to All Accounts and preserves flag color", () => {
    const accounts = [account("cash-1", "Everyday Cash")];
    const allAccount = buildRegisterSearchSuggestions("everyday", accounts, options, [], true);
    const oneAccount = buildRegisterSearchSuggestions("everyday", accounts, options, [], false);
    expect(allAccount[0]?.key).toBe("account:cash-1");
    expect(oneAccount.some((suggestion) => suggestion.key === "account:cash-1")).toBe(false);
    expect(buildRegisterSearchSuggestions("check", [], options, [], false).find((suggestion) => suggestion.key === "flag:flag-check")?.color).toBe("#f0c000");
  });
});

describe("register search filters", () => {
  it("keeps generic any-field search and supports field-specific term matching", () => {
    const row = entry();
    expect(matchesRegisterSearchFilter(row, null, { kind: "any", query: "green 12 500" })).toBe(true);
    expect(matchesRegisterSearchFilter(row, null, { kind: "payee", query: "GREEN market" })).toBe(true);
    expect(matchesRegisterSearchFilter(row, null, { kind: "category", query: "daily groc" })).toBe(true);
    expect(matchesRegisterSearchFilter(row, null, { kind: "memo", query: "weekly shop" })).toBe(true);
    expect(matchesRegisterSearchFilter(row, null, { kind: "memo", query: "green" })).toBe(false);
  });

  it("matches account, category, and flag suggestions by stable IDs", () => {
    const row = entry();
    const owner = account("cash-1", "Everyday Cash");
    expect(matchesRegisterSearchFilter(row, owner, { kind: "account", id: "cash-1", label: "renamed label" })).toBe(true);
    expect(matchesRegisterSearchFilter(row, owner, { kind: "account", id: "cash-2", label: "Everyday Cash" })).toBe(false);
    expect(matchesRegisterSearchFilter(row, owner, { kind: "category-id", id: "cat-food", label: "Business / Groceries" })).toBe(true);
    expect(matchesRegisterSearchFilter(row, owner, { kind: "category-id", id: "cat-other-food", label: "Daily / Groceries" })).toBe(false);
    expect(matchesRegisterSearchFilter(row, owner, { kind: "category-group", id: "Daily", label: "Daily" })).toBe(true);
    expect(matchesRegisterSearchFilter(row, owner, { kind: "category-group", id: "Business", label: "Business" })).toBe(false);
    expect(matchesRegisterSearchFilter(row, owner, { kind: "flag", id: "flag-check", label: "renamed" })).toBe(true);
  });
});
