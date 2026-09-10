import { describe, expect, it } from "vitest";
import { formatDate, formatHuf } from "../src/lib/format";

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
});
