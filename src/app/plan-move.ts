import { parseSignedHufInput } from "../lib/format";

export const READY_TO_ASSIGN_DESTINATION = "__ready_to_assign__";

export type PlanMovePayload = { fromCategoryId: string; toCategoryId: string | null; amount: string };

export function defaultPlanMoveAmount(available: string): string {
  return BigInt(available) > 0n ? available : "";
}

export function createPlanMovePayload(sourceId: string, destination: string, amountText: string): PlanMovePayload {
  const amount = parseSignedHufInput(amountText);
  if (!sourceId || !destination || amount <= 0n) throw new Error("A source, destination and positive amount are required.");
  if (destination === sourceId) throw new Error("Source and destination must differ.");
  return { fromCategoryId: sourceId, toCategoryId: destination === READY_TO_ASSIGN_DESTINATION ? null : destination, amount: amount.toString() };
}

export function canSubmitPlanMove(sourceId: string, destination: string, amountText: string): boolean {
  try { createPlanMovePayload(sourceId, destination, amountText); return true; }
  catch { return false; }
}

export function planMoveDestinations<T extends { categoryId: string }>(categories: T[], sourceId: string): T[] {
  return categories.filter((category) => category.categoryId !== sourceId);
}

export function isPlanMoveRequestCurrent(requestedMonth: string, currentMonth: string, requestedGeneration: number, currentGeneration: number): boolean {
  return requestedMonth === currentMonth && requestedGeneration === currentGeneration;
}

export function shouldDismissPlanMove(isBusy: boolean, ownedVersion: number | null, currentVersion: number): boolean {
  return !isBusy && ownedVersion !== currentVersion;
}

export function ownedPlanMoveVersion(startVersion: number, settledVersion: number): number | null {
  // A saved action emits once on entry and once on exit. Extra events belong
  // to another write and invalidate the captured popup values.
  return settledVersion === startVersion + 2 ? settledVersion : null;
}

