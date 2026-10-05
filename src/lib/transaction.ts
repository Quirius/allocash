import { createManualTransaction, createManualTransfer, createMonthlySchedule, type AccountOverview, type ManualTransactionInput, type MonthlyScheduleInput } from "./desktop";

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
  });
}

export async function createScheduledPayeeEntry(input: MonthlyScheduleInput, accounts: AccountOverview[]): Promise<void> {
  const counterpartId = input.counterpartAccountId ?? resolveTransferPayee(input.payeeName?.trim() ?? "", input.accountId, accounts);
  return createMonthlySchedule({ ...input, counterpartAccountId: counterpartId, payeeName: counterpartId ? null : input.payeeName });
}

export type EntryRepeat = "never" | "monthly" | "quarterly" | "yearly";

export function scheduleForEntry(date: string, repeat: EntryRepeat, today: string): { intervalMonths: 1 | 3 | 12; endDate: string | null } | null {
  if (repeat === "never") return date > today ? { intervalMonths: 1, endDate: date } : null;
  return { intervalMonths: repeat === "monthly" ? 1 : repeat === "quarterly" ? 3 : 12, endDate: null };
}
