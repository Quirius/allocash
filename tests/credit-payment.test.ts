import { describe, expect, it } from "vitest";
import { creditPaymentStatus } from "../src/app/credit-payment";

describe("credit payment warnings", () => {
  it("distinguishes a payment shortfall from negative payment availability", () => {
    expect(creditPaymentStatus("-128590", "78590")).toEqual({ state: "underfunded", shortfall: 50000n, overspent: 0n });
    expect(creditPaymentStatus("-128590", "-21410")).toEqual({ state: "overspent", shortfall: 150000n, overspent: 21410n });
  });
  it("counts zero availability as underfunded only when there is debt", () => {
    expect(creditPaymentStatus("-1", "0").state).toBe("underfunded");
    expect(creditPaymentStatus("0", "0").state).toBe("funded");
    expect(creditPaymentStatus("100", "0").state).toBe("funded");
  });
  it("allows enough or excess funding and prioritizes overspending even without debt", () => {
    expect(creditPaymentStatus("-100", "100").state).toBe("funded");
    expect(creditPaymentStatus("-100", "101").shortfall).toBe(0n);
    expect(creditPaymentStatus("100", "-10")).toEqual({ state: "overspent", shortfall: 10n, overspent: 10n });
  });
  it("preserves integer precision across the full stored HUF range", () => {
    expect(creditPaymentStatus("-9223372036854775808", "-9223372036854775808").shortfall).toBe(18446744073709551616n);
  });
});
