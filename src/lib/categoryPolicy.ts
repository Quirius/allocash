import type { AccountOverview } from "./desktop";

export type TransactionDirection = "inflow" | "outflow";

const onBudget = (account: AccountOverview) => account.kind === "cash" || account.kind === "credit";

/** Describes category input for the source account's signed amount direction. */
export function categoryPolicy(
  account: AccountOverview,
  direction: TransactionDirection,
  counterpart?: AccountOverview,
) {
  if (!counterpart) {
    if (!onBudget(account)) return { show: false, required: false, readyToAssignDefault: false };
    return direction === "inflow"
      ? { show: true, required: false, readyToAssignDefault: true }
      : { show: true, required: true, readyToAssignDefault: false };
  }

  if (onBudget(account) === onBudget(counterpart)) {
    return { show: false, required: false, readyToAssignDefault: false };
  }
  // The peer has the opposite signed direction. The category belongs to the
  // budget leg, which defaults only when money is entering the budget.
  const budgetLegDirection = onBudget(account)
    ? direction
    : direction === "inflow" ? "outflow" : "inflow";
  return budgetLegDirection === "inflow"
    ? { show: true, required: false, readyToAssignDefault: true }
    : { show: true, required: true, readyToAssignDefault: false };
}

export function readyToAssignCategoryId(categories: Array<{ id: string; groupName: string; name: string }>): string | null {
  return categories.find((category) => isReadyToAssignCategory(category.groupName, category.name))?.id ?? null;
}

export function isReadyToAssignCategory(groupName: string | null, name: string | null): boolean {
  return groupName?.trim().toLowerCase() === "inflow" && name?.trim().toLowerCase() === "ready to assign";
}

export type CategoryOrigin = "automatic-ready" | "explicit" | "existing" | "empty";

export function transitionCategoryOrigin(input: {
  categoryId: string;
  origin: CategoryOrigin;
  show: boolean;
  required: boolean;
  readyToAssignDefault: boolean;
  readyToAssignId: string | null;
  allowDefault: boolean;
}): { categoryId: string; origin: CategoryOrigin } {
  if (input.origin === "automatic-ready" && (!input.show || input.required)) return { categoryId: "", origin: "empty" };
  if (input.allowDefault && input.readyToAssignDefault && (input.origin === "empty" || input.origin === "automatic-ready")) {
    return { categoryId: input.readyToAssignId ?? "", origin: "automatic-ready" };
  }
  return { categoryId: input.categoryId, origin: input.origin };
}

export function inheritedReadyNeedsReset(input: {
  origin: CategoryOrigin;
  categoryId: string;
  initiallyDefaultedToReady: boolean;
  nextScopeVisible: boolean;
  nextRequiresChoice: boolean;
  readyToAssignId: string | null;
  categoryGroupName?: string | null;
  categoryName?: string | null;
}): boolean {
  return input.origin === "existing" && input.initiallyDefaultedToReady &&
    (!input.nextScopeVisible || input.nextRequiresChoice) &&
    (!!input.categoryId && (input.categoryId === input.readyToAssignId || isReadyToAssignCategory(input.categoryGroupName ?? null, input.categoryName ?? null)));
}
