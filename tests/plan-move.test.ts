import { describe, expect, it } from "vitest";
import { canSubmitPlanMove, createPlanMovePayload, defaultPlanMoveAmount, isPlanMoveRequestCurrent, ownedPlanMoveVersion, planMoveDestinations, READY_TO_ASSIGN_DESTINATION, shouldDismissPlanMove } from "../src/app/plan-move";

describe("Plan move popup helpers", () => {
  it("prefills only positive Available values", () => {
    expect(defaultPlanMoveAmount("12500")).toBe("12500");
    expect(defaultPlanMoveAmount("0")).toBe("");
    expect(defaultPlanMoveAmount("-10")).toBe("");
  });

  it("keeps the clicked source fixed and out of destinations", () => {
    const categories = [{ categoryId: "a" }, { categoryId: "b" }];
    expect(planMoveDestinations(categories, "a")).toEqual([{ categoryId: "b" }]);
    expect(() => createPlanMovePayload("a", "a", "1")).toThrow();
  });

  it("creates the expected category and Ready to Assign payloads", () => {
    expect(createPlanMovePayload("a", "b", "40")).toEqual({ fromCategoryId: "a", toCategoryId: "b", amount: "40" });
    expect(createPlanMovePayload("a", READY_TO_ASSIGN_DESTINATION, "40")).toEqual({ fromCategoryId: "a", toCategoryId: null, amount: "40" });
    expect(() => createPlanMovePayload("a", "b", "0")).toThrow();
    expect(() => createPlanMovePayload("a", "b", "-4")).toThrow();
    expect(() => createPlanMovePayload("a", "", "4")).toThrow();
  });

  it("disables invalid, overflowed and same-category submissions", () => {
    expect(canSubmitPlanMove("a", "b", "10")).toBe(true);
    expect(canSubmitPlanMove("a", "b", "0")).toBe(false);
    expect(canSubmitPlanMove("a", "b", "-1")).toBe(false);
    expect(canSubmitPlanMove("a", "b", "1.5")).toBe(false);
    expect(canSubmitPlanMove("a", "b", "9223372036854775808")).toBe(false);
    expect(canSubmitPlanMove("a", "a", "10")).toBe(false);
  });

  it("accepts completion only for the same month and popup generation", () => {
    expect(isPlanMoveRequestCurrent("2026-10", "2026-10", 4, 4)).toBe(true);
    expect(isPlanMoveRequestCurrent("2026-10", "2026-11", 4, 4)).toBe(false);
    expect(isPlanMoveRequestCurrent("2026-10", "2026-10", 4, 5)).toBe(false);
  });

  it("preserves an owned save release and dismisses on a later external mutation", () => {
    expect(ownedPlanMoveVersion(20, 22)).toBe(22);
    expect(ownedPlanMoveVersion(20, 24)).toBeNull();
    expect(shouldDismissPlanMove(false, null, 24)).toBe(true);
    expect(shouldDismissPlanMove(false, 22, 22)).toBe(false);
    expect(shouldDismissPlanMove(true, null, 22)).toBe(false);
    expect(shouldDismissPlanMove(false, 22, 23)).toBe(true);
  });
});
