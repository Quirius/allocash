import type { CategoryTargetProgress } from "../lib/desktop";
import { formatHuf } from "../lib/format";

export type CategoryTargetPresentation = {
  status: "Funded" | "Fully Spent" | "On Track" | "Underfunded" | "Snoozed";
  detail: string;
  fullyFunded: boolean;
  fullySpent: boolean;
};

export function categoryTargetPresentation(target: CategoryTargetProgress, activity: string, available: string, month: string): CategoryTargetPresentation {
  const toGo = BigInt(target.toGo);
  const monthlyActivity = BigInt(activity);
  const monthlySpend = monthlyActivity < 0n ? -monthlyActivity : 0n;
  const fullyFunded = !target.snoozed && toGo <= 0n;
  const periodicRefill = target.behavior === "refill" && (target.intervalMonths ?? 1) > 1 && target.periodSpent != null;
  const spend = periodicRefill ? BigInt(target.periodSpent!) : monthlySpend;
  const referenceAmount = BigInt(target.amount);
  const positiveAvailable = BigInt(available) > 0n ? BigInt(available) : 0n;
  const periodComplete = periodicRefill && spend + positiveAvailable >= referenceAmount;
  const fullySpent = fullyFunded && BigInt(available) === 0n && (periodicRefill ? spend >= referenceAmount : spend > 0n);
  const onTrack = fullyFunded && !periodComplete && !!target.dueMonth && target.dueMonth > month;
  const status = target.snoozed ? "Snoozed" : fullySpent ? "Fully Spent" : onTrack ? "On Track" : fullyFunded ? "Funded" : "Underfunded";
  const detail = target.snoozed || (fullyFunded && monthlySpend === 0n) ? ""
    : monthlySpend > 0n
    ? "Spent " + formatHuf(monthlySpend) + " of " + formatHuf(referenceAmount)
    : toGo > 0n
      ? "Needs " + formatHuf(toGo) + " more"
      : "Funded " + formatHuf(BigInt(target.funded)) + " of " + formatHuf(referenceAmount);
  return { status, detail, fullyFunded, fullySpent };
}

export function shouldShowTargetAvailableCheck(target: CategoryTargetProgress | null, available: string, isCreditPayment: boolean): boolean {
  return !isCreditPayment && !!target && !target.snoozed && BigInt(target.toGo) <= 0n && BigInt(available) >= 0n;
}
