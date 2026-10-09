import { expect, it } from "vitest";
import type { AccountOverview } from "../src/lib/desktop";
import { categoryPolicy, inheritedReadyNeedsReset, isReadyToAssignCategory, readyToAssignCategoryId, transitionCategoryOrigin } from "../src/lib/categoryPolicy";

const account = (kind: AccountOverview["kind"], id = kind): AccountOverview => ({
  id, name: id, kind, closed: false, sortOrder: 0,
  balance: { working: "0", cleared: "0", uncleared: "0", reconciled: "0" },
});

it.each(["cash", "credit"] as const)("requires a category for %s outflows and defaults inflows to Ready to Assign", (kind) => {
  expect(categoryPolicy(account(kind), "outflow")).toMatchObject({ show: true, required: true, readyToAssignDefault: false });
  expect(categoryPolicy(account(kind), "inflow")).toMatchObject({ show: true, required: false, readyToAssignDefault: true });
});

it.each(["loan", "tracking"] as const)("hides categories for %s ordinary entries", (kind) => {
  expect(categoryPolicy(account(kind), "outflow")).toMatchObject({ show: false, required: false });
  expect(categoryPolicy(account(kind), "inflow")).toMatchObject({ show: false, required: false });
});

it.each([["cash", "credit"], ["loan", "tracking"]] as const)("does not categorize %s to %s transfers", (source, peer) => {
  expect(categoryPolicy(account(source), "outflow", account(peer))).toMatchObject({ show: false, required: false });
  expect(categoryPolicy(account(source), "inflow", account(peer))).toMatchObject({ show: false, required: false });
});

it.each([
  ["cash", "loan", "outflow", true, false],
  ["cash", "loan", "inflow", false, true],
  ["loan", "cash", "outflow", false, true],
  ["loan", "cash", "inflow", true, false],
  ["credit", "tracking", "outflow", true, false],
  ["tracking", "credit", "inflow", true, false],
] as const)("assigns crossing-transfer category to budget leg (%s -> %s, %s)", (source, peer, direction, required, readyDefault) => {
  expect(categoryPolicy(account(source), direction, account(peer))).toMatchObject({ show: true, required, readyToAssignDefault: readyDefault });
});

it("recognizes the canonical Ready to Assign group and category with trim/case normalization", () => {
  expect(readyToAssignCategoryId([
    { id: "wrong", groupName: "Food", name: "Ready to Assign" },
    { id: "ready", groupName: " InFlOw ", name: " Ready to Assign " },
  ])).toBe("ready");
  expect(readyToAssignCategoryId([])).toBeNull();
  expect(isReadyToAssignCategory(" inflow ", " READY TO ASSIGN ")).toBe(true);
});

it("creates an automatic Ready category when the selected budget leg is an inflow, including off-budget source outflows", () => {
  const policy = categoryPolicy(account("tracking"), "outflow", account("cash"));
  expect(transitionCategoryOrigin({ categoryId: "", origin: "empty", ...policy, readyToAssignId: null, allowDefault: true }))
    .toEqual({ categoryId: "", origin: "automatic-ready" });
  expect(transitionCategoryOrigin({ categoryId: "", origin: "empty", ...policy, readyToAssignId: "ready", allowDefault: true }))
    .toEqual({ categoryId: "ready", origin: "automatic-ready" });
});

it("clears automatic Ready on a budget outflow while keeping an explicit choice", () => {
  const policy = categoryPolicy(account("tracking"), "inflow", account("cash"));
  expect(transitionCategoryOrigin({ categoryId: "ready", origin: "automatic-ready", ...policy, readyToAssignId: "ready", allowDefault: true }))
    .toEqual({ categoryId: "", origin: "empty" });
  expect(transitionCategoryOrigin({ categoryId: "rent", origin: "explicit", ...policy, readyToAssignId: "ready", allowDefault: true }))
    .toEqual({ categoryId: "rent", origin: "explicit" });
});

it("preserves an existing non-Ready category and clears automatic categories when a scope disappears", () => {
  const outgoing = categoryPolicy(account("cash"), "outflow");
  expect(transitionCategoryOrigin({ categoryId: "rent", origin: "existing", ...outgoing, readyToAssignId: "ready", allowDefault: true }))
    .toEqual({ categoryId: "rent", origin: "existing" });
  const internal = categoryPolicy(account("cash"), "outflow", account("credit"));
  expect(transitionCategoryOrigin({ categoryId: "ready", origin: "automatic-ready", ...internal, readyToAssignId: "ready", allowDefault: true }))
    .toEqual({ categoryId: "", origin: "empty" });
});

it("recognizes inherited Ready defaults from either transfer leg and resets them when the budget leg starts exiting", () => {
  const exiting = categoryPolicy(account("tracking"), "inflow", account("cash"));
  expect(inheritedReadyNeedsReset({
    origin: "existing", categoryId: "hidden-ready", initiallyDefaultedToReady: true,
    nextScopeVisible: exiting.show, nextRequiresChoice: exiting.required, readyToAssignId: null,
    categoryGroupName: " Inflow ", categoryName: " Ready to Assign ",
  })).toBe(true);
  expect(inheritedReadyNeedsReset({
    origin: "explicit", categoryId: "ready", initiallyDefaultedToReady: true,
    nextScopeVisible: exiting.show, nextRequiresChoice: exiting.required, readyToAssignId: "ready",
  })).toBe(false);
  const internal = categoryPolicy(account("tracking"), "outflow", account("loan"));
  expect(inheritedReadyNeedsReset({
    origin: "existing", categoryId: "ready", initiallyDefaultedToReady: true,
    nextScopeVisible: internal.show, nextRequiresChoice: internal.required, readyToAssignId: "ready",
  })).toBe(true);
});
