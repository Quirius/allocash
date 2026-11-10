import { describe, expect, it } from "vitest";
import { parseAmountExpression } from "../src/lib/amount-expression";

describe("parseAmountExpression", () => {
  it("evaluates precedence, parentheses, unary signs, and grouped literals", () => {
    expect(parseAmountExpression("1 000 + 2 500 * 2")).toBe(6000n);
    expect(parseAmountExpression("(1 000 + 500) * 2 Ft")).toBe(3000n);
    expect(parseAmountExpression("-(1 000 + 500)")).toBe(-1500n);
    expect(parseAmountExpression("1 000 / 3 * 3")).toBe(1000n);
  });

  it("supports the signed 64-bit endpoints", () => {
    expect(parseAmountExpression("9223372036854775807")).toBe(9223372036854775807n);
    expect(parseAmountExpression("-(9223372036854775808)")).toBe(-9223372036854775808n);
  });

  it.each([["10 / 3", 3n], ["20 / 3", 7n], ["5 / 2", 3n], ["1 / 2", 1n], ["1 / 3", 0n], ["-5 / 2", -3n], ["-(5 / 2)", -3n], ["-10 / 3", -3n], ["1 000 / 3 * 3", 1000n], ["7 / 2 + 7 / 2", 7n]])("rounds the final result of %s to the nearest whole HUF, halves away from zero", (value, expected) => {
    expect(parseAmountExpression(value)).toBe(expected);
  });

  it.each(["1 00", "1 +", "1 / 0", "9223372036854775808", "-(9223372036854775809)", "1 ** 2", "()"])("rejects %s", (value) => {
    expect(() => parseAmountExpression(value)).toThrow();
  });
});
