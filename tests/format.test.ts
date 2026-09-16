import { describe, expect, it } from "vitest";
import { formatDate, formatHuf, localCalendarDate, localCalendarMonth, parseHufInput, parseSignedHufInput, shiftCalendarMonth } from "../src/lib/format";

describe("integer HUF formatting", () => {
  it.each([
    [0n, "0 Ft"],
    [1234567n, "1 234 567 Ft"],
    [-7325n, "−7 325 Ft"],
    [9223372036854775807n, "9 223 372 036 854 775 807 Ft"],
    [-9223372036854775808n, "−9 223 372 036 854 775 808 Ft"],
  ])("formats %s without losing precision", (value, expected) => {
    expect(formatHuf(value)).toBe(expected);
  });

  it.each([
    ["1", 1n],
    ["12 500", 12500n],
    ["9 223 372 036 854 775 807 Ft", 9223372036854775807n],
  ])("parses manual input %s exactly", (value, expected) => {
    expect(parseHufInput(value)).toBe(expected);
  });

  it.each(["", "0", "-1", "1.5", "1,000", "12 34", "9223372036854775808"])(
    "rejects invalid manual amount %s",
    (value) => expect(() => parseHufInput(value)).toThrow(),
  );
});

describe("signed Plan HUF input", () => {
  it.each([["0", 0n], ["12 500", 12500n], ["-12 500 Ft", -12500n]])("parses %s", (value, expected) => expect(parseSignedHufInput(value)).toBe(expected));
  it.each(["+1", "12 50", "1.5", "-9223372036854775809"])("rejects %s", (value) => expect(() => parseSignedHufInput(value)).toThrow());
});

describe("timezone-free calendar dates", () => {
  it.each([
    ["2026-09-10", "2026.09.10."],
    ["2024-02-29", "2024.02.29."],
    ["2000-02-29", "2000.02.29."],
    ["2026-12-31", "2026.12.31."],
  ])("formats %s", (value, expected) => {
    expect(formatDate(value)).toBe(expected);
  });
  it.each(["2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-09-00", "0000-01-01", "2026-9-10", "2026-09-10T00:00:00Z", ""]) (
    "rejects invalid or ambiguous date %s", (value) => {
      expect(() => formatDate(value)).toThrow();
    },
  );

  it("builds the balance cutoff from local date components", () => {
    expect(localCalendarDate(new Date(2026, 8, 4, 23, 30))).toBe("2026-09-04");
  });
});

describe("plan months", () => {
  it("formats and shifts months without timezone conversion", () => {
    expect(localCalendarMonth(new Date(2026, 8, 15))).toBe("2026-09");
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
    expect(() => shiftCalendarMonth("2026-13", 1)).toThrow("Invalid plan month.");
  });
});
