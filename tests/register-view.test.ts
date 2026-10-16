import { describe, expect, it } from "vitest";
import type { RegisterEntry } from "../src/lib/desktop";
import {
  DEFAULT_REGISTER_VIEW_OPTIONS,
  filterRegisterEntries,
  getRegisterDateRange,
  getRegisterRunningBalances,
  type RegisterViewOptions,
} from "../src/app/register-view";

function entry(id: string, date: string, amount: string, overrides: Partial<RegisterEntry> = {}): RegisterEntry {
  return {
    id, date, amount, payeeName: null, categoryId: null, categoryGroupName: null, categoryName: null,
    memo: "", flagId: null, flagName: null, flagColor: null, clearedState: "uncleared",
    postingState: "posted", origin: "manual", transferId: null, transferAccountName: null,
    ...overrides,
  };
}

const options = (overrides: Partial<RegisterViewOptions> = {}): RegisterViewOptions => ({ ...DEFAULT_REGISTER_VIEW_OPTIONS, datePreset: "AllDates", ...overrides });

describe("register view date ranges", () => {
  it("handles month and year presets across December and January", () => {
    expect(getRegisterDateRange(options({ datePreset: "ThisMonth" }), "2026-01-03")).toEqual({ fromDate: "2026-01-01", toDate: "2026-01-31" });
    expect(getRegisterDateRange(options({ datePreset: "LastMonth" }), "2026-01-03")).toEqual({ fromDate: "2025-12-01", toDate: "2025-12-31" });
    expect(getRegisterDateRange(options({ datePreset: "Latest3Months" }), "2026-01-03")).toEqual({ fromDate: "2025-11-01", toDate: "2026-01-31" });
    expect(getRegisterDateRange(options({ datePreset: "ThisYear" }), "2026-12-31")).toEqual({ fromDate: "2026-01-01", toDate: "2026-12-31" });
    expect(getRegisterDateRange(options({ datePreset: "LastYear" }), "2026-01-01")).toEqual({ fromDate: "2025-01-01", toDate: "2025-12-31" });
    expect(getRegisterDateRange(options({ datePreset: "AllDates" }), "2026-01-01")).toEqual({ fromDate: null, toDate: null });
  });

  it("uses inclusive custom month boundaries and hides reconciled only when requested", () => {
    const rows = [
      entry("before", "2025-12-31", "1"),
      entry("first", "2026-01-01", "2"),
      entry("last", "2026-02-28", "3", { clearedState: "reconciled" }),
      entry("after", "2026-03-01", "4"),
    ];
    const custom = options({ datePreset: "Custom", customFromMonth: "2026-01", customToMonth: "2026-02", showReconciled: false });
    expect(filterRegisterEntries(rows, custom, "2026-02-10").map(({ id }) => id)).toEqual(["first"]);
    expect(filterRegisterEntries(rows, { ...custom, showReconciled: true }, "2026-02-10").map(({ id }) => id)).toEqual(["first", "last"]);
  });
});

describe("register running balances", () => {
  it("uses exact BigInt values, full prior history, refunds, and both transfer legs", () => {
    const rows = [
      entry("latest", "2026-03-04", "-9007199254740993"),
      entry("refund", "2026-03-03", "500", { origin: "manual" }),
      entry("transfer-in", "2026-03-02", "2000", { transferId: "t1", transferAccountName: "Savings" }),
      entry("transfer-out", "2026-03-02", "-2000", { transferId: "t1", transferAccountName: "Everyday" }),
      entry("max-carry", "2026-01-02", "807"),
      entry("opening", "2026-01-01", "9223372036854775000", { memo: "Opening balance" }),
    ];
    expect(getRegisterRunningBalances(rows, "2026-03-04")).toEqual(new Map([
      ["opening", "9223372036854775000"],
      ["max-carry", "9223372036854775807"],
      ["transfer-out", "9223372036854773807"],
      ["transfer-in", "9223372036854775807"],
      ["refund", "9223372036854776307"],
      ["latest", "9214364837600035314"],
    ]));
  });

  it("walks same-date rows in reverse register order and leaves scheduled or future balances blank", () => {
    const rows = [
      entry("newest-first", "2026-05-10", "7"),
      entry("older-second", "2026-05-10", "5"),
      entry("older-first", "2026-05-10", "3"),
      entry("scheduled", "2026-05-09", "100", { postingState: "scheduled" }),
      entry("future-posted", "2026-05-11", "200"),
    ];
    expect(getRegisterRunningBalances(rows, "2026-05-10")).toEqual(new Map([
      ["older-first", "3"], ["older-second", "8"], ["newest-first", "15"],
      ["scheduled", null], ["future-posted", null],
    ]));
    expect(filterRegisterEntries(rows, options({ datePreset: "AllDates" }), "2026-05-10").map(({ id }) => id)).toEqual(rows.map(({ id }) => id));
  });

  it("preserves a zero balance as a real value", () => {
    expect(getRegisterRunningBalances([entry("in", "2026-01-01", "42"), entry("out", "2026-01-02", "-42")], "2026-01-02").get("out")).toBe("0");
  });
});
