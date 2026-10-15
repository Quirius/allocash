import { describe, expect, it } from "vitest";
import type { CategoryTargetProgress } from "../src/lib/desktop";
import { categoryTargetPresentation, shouldShowTargetAvailableCheck } from "../src/app/plan-category-presentation";

const month = "2026-10";
function target(overrides: Partial<CategoryTargetProgress> = {}): CategoryTargetProgress {
  return {
    behavior: "refill", amount: "30000", dueKind: "last_day", dueDay: null,
    intervalMonths: 1, firstDueMonth: null, neededThisMonth: "30000", funded: "30000",
    toGo: "0", snoozed: false, dueMonth: month, ...overrides,
  };
}

describe("plan category target presentation", () => {
  it("shows an underfunded target as underfunded, including its remaining amount", () => {
    const result = categoryTargetPresentation(target({ funded: "10000", toGo: "20000" }), "-7500", "2500", month);
    expect(result.status).toBe("Underfunded");
    expect(result.detail).toContain("Spent");
    expect(result.fullyFunded).toBe(false);
    expect(categoryTargetPresentation(target({ funded: "10000", toGo: "20000" }), "0", "10000", month).detail).toContain("Needs");
  });

  it("shows current month spending against the monthly requirement", () => {
    const result = categoryTargetPresentation(target(), "-7500", "22500", month);
    expect(result.status).toBe("Funded");
    expect(result.detail).toContain("Spent");
    expect(result.detail).toContain("30 000 Ft");
  });

  it("uses the overall goal for a future target and only calls it on track when funded", () => {
    const future = target({ amount: "90000", neededThisMonth: "30000", dueMonth: "2026-12" });
    expect(categoryTargetPresentation(future, "-7500", "22500", month).status).toBe("On Track");
    expect(categoryTargetPresentation(future, "-7500", "22500", month).detail).toContain("90 000 Ft");
    expect(categoryTargetPresentation(target({ ...future, toGo: "1", funded: "29999" }), "0", "29999", month).status).toBe("Underfunded");
  });

  it("requires zero available money as well as spending before saying fully spent", () => {
    expect(categoryTargetPresentation(target(), "-30000", "0", month).status).toBe("Fully Spent");
    expect(categoryTargetPresentation(target(), "-30000", "100", month).status).toBe("Funded");
  });

  it("allows fully funded carryover targets with zero monthly need, but excludes snoozed targets", () => {
    const carryover = target({ neededThisMonth: "0", funded: "0", amount: "30000", toGo: "0" });
    const carryoverPresentation = categoryTargetPresentation(carryover, "0", "2000", month);
    expect(carryoverPresentation.fullyFunded).toBe(true);
    expect(carryoverPresentation.detail).toBe("");
    expect(shouldShowTargetAvailableCheck(carryover, "2000", false)).toBe(true);
    const snoozed = target({ snoozed: true });
    expect(categoryTargetPresentation(snoozed, "0", "30000", month).status).toBe("Snoozed");
    expect(categoryTargetPresentation(snoozed, "0", "30000", month).detail).toBe("");
    expect(shouldShowTargetAvailableCheck(snoozed, "30000", false)).toBe(false);
  });

  it("only shows a check for non-credit categories with a funded target", () => {
    const funded = target();
    expect(shouldShowTargetAvailableCheck(funded, "1", false)).toBe(true);
    expect(shouldShowTargetAvailableCheck(funded, "0", false)).toBe(true);
    expect(shouldShowTargetAvailableCheck(funded, "-1", false)).toBe(false);
    expect(shouldShowTargetAvailableCheck(funded, "1", true)).toBe(false);
    expect(shouldShowTargetAvailableCheck(null, "1", false)).toBe(false);
  });
});

describe("periodic refill completion", () => {
  const yearly = target({ intervalMonths: 12, firstDueMonth: "2026-12", dueMonth: "2026-12", neededThisMonth: "0", funded: "0", toGo: "0", periodSpent: "30000" });
  it("shows fully spent after earlier period spending even with zero monthly activity", () => {
    const result = categoryTargetPresentation(yearly, "0", "0", month);
    expect(result.status).toBe("Fully Spent");
    expect(result.fullySpent).toBe(true);
    expect(result.detail).toBe("");
    expect(shouldShowTargetAvailableCheck(yearly, "0", false)).toBe(true);
  });
  it("distinguishes a completed annual pool from only meeting this month's pace", () => {
    expect(categoryTargetPresentation({ ...yearly, periodSpent: "0" }, "0", "30000", month).status).toBe("Funded");
    expect(categoryTargetPresentation({ ...yearly, periodSpent: "10000" }, "0", "0", month).status).toBe("On Track");
    expect(categoryTargetPresentation({ ...yearly, toGo: "1" }, "0", "0", month).status).toBe("Underfunded");
    expect(categoryTargetPresentation({ ...yearly, snoozed: true }, "0", "0", month).status).toBe("Snoozed");
  });
  it("keeps refunds and remaining money from appearing fully spent", () => {
    expect(categoryTargetPresentation({ ...yearly, periodSpent: "20000" }, "10000", "10000", month).status).toBe("Funded");
    expect(categoryTargetPresentation(yearly, "0", "1000", month).status).toBe("Funded");
  });
});
