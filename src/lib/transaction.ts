import { createManualTransaction, createManualTransfer, createMonthlySchedule, createRecurringEntry, type AccountOverview, type ManualTransactionInput, type MonthlyScheduleInput } from "./desktop";
import { shiftCalendarMonth } from "./format";

export function isTransferPayee(payee: string): boolean {
  return /^(transfer|payment)\s*:/i.test(payee.trim());
}

// Resolve explicit account labels only; never guess a partial account name.
export function resolveTransferPayee(payee: string, accountId: string, accounts: AccountOverview[]): string | null {
  if (!isTransferPayee(payee)) return null;
  const name = payee.slice(payee.indexOf(":") + 1).trim();
  const matches = accounts.filter((account) => account.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
  if (!name || matches.length !== 1) throw new Error("Choose an exact transfer account using Transfer → Other account.");
  const counterpart = matches[0]!;
  if (counterpart.id === accountId) throw new Error("A transfer needs two different accounts.");
  if (counterpart.closed) throw new Error("Transfers cannot use a closed account.");
  return counterpart.id;
}

export async function createPayeeEntry(input: ManualTransactionInput, accounts: AccountOverview[]): Promise<string> {
  const counterpartId = resolveTransferPayee(input.payeeName?.trim() ?? "", input.accountId, accounts);
  if (!counterpartId) return createManualTransaction(input);
  const amount = BigInt(input.amount);
  return createManualTransfer({
    accountId: input.accountId,
    counterpartAccountId: counterpartId,
    date: input.date,
    memo: input.memo,
    flagId: input.flagId,
    amount: (amount < 0n ? -amount : amount).toString(),
    direction: amount < 0n ? "outflow" : "inflow",
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
  });
}

export async function createScheduledPayeeEntry(input: MonthlyScheduleInput, accounts: AccountOverview[]): Promise<void> {
  const counterpartId = input.counterpartAccountId ?? resolveTransferPayee(input.payeeName?.trim() ?? "", input.accountId, accounts);
  return createMonthlySchedule({ ...input, counterpartAccountId: counterpartId, payeeName: counterpartId ? null : input.payeeName });
}

/** The date one repeat interval after `date`, clamped to the target month's length (the schedule keeps the original day). */
export function nextRecurrenceDate(date: string, intervalMonths: number): string {
  const day = Number(date.slice(8));
  const month = shiftCalendarMonth(date.slice(0, 7), intervalMonths);
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${Math.min(day, length).toString().padStart(2, "0")}`;
}

/**
 * A repeating entry dated today or earlier is a normal posted entry; the repeat becomes a
 * schedule whose first occurrence is one interval later.
 */
export async function createRecurringPayeeEntry(input: ManualTransactionInput, intervalMonths: 1 | 3 | 12, accounts: AccountOverview[], counterpartOverride?: string | null): Promise<string> {
  const counterpartId = counterpartOverride ?? resolveTransferPayee(input.payeeName?.trim() ?? "", input.accountId, accounts);
  const schedule: MonthlyScheduleInput = {
    accountId: input.accountId, startDate: nextRecurrenceDate(input.date, intervalMonths), dayOfMonth: Number(input.date.slice(8)), endDate: null,
    payeeName: counterpartId ? null : input.payeeName, categoryId: input.categoryId ?? null, memo: input.memo, flagId: input.flagId, amount: input.amount,
    intervalMonths, counterpartAccountId: counterpartId,
  };
  if (!counterpartId) return createRecurringEntry({ transaction: input, schedule });
  const amount = BigInt(input.amount);
  return createRecurringEntry({
    transfer: {
      accountId: input.accountId, counterpartAccountId: counterpartId, date: input.date, memo: input.memo, flagId: input.flagId,
      amount: (amount < 0n ? -amount : amount).toString(), direction: amount < 0n ? "outflow" : "inflow",
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    },
    schedule,
  });
}

export type EntryRepeat = "never" | "monthly" | "quarterly" | "yearly";

export function scheduleForEntry(date: string, repeat: EntryRepeat, today: string): { intervalMonths: 1 | 3 | 12; endDate: string | null } | null {
  if (repeat === "never") return date > today ? { intervalMonths: 1, endDate: date } : null;
  return { intervalMonths: repeat === "monthly" ? 1 : repeat === "quarterly" ? 3 : 12, endDate: null };
}
