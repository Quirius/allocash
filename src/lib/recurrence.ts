import type { RecurrenceMonths } from "./desktop";

export function recurrenceLabel(intervalMonths: RecurrenceMonths = 1): string {
  return intervalMonths === 12 ? "Yearly" : intervalMonths === 3 ? "Quarterly" : "Monthly";
}
