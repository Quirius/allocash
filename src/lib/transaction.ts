import { createManualTransaction, createManualTransfer, type AccountOverview, type ManualTransactionInput } from "./desktop";

export function isTransferPayee(payee: string): boolean {
  return /^(transfer|payment)\s*:/i.test(payee.trim());
}

// Resolve explicit account labels only; never guess a partial account name.
export async function createPayeeEntry(input: ManualTransactionInput, accounts: AccountOverview[]): Promise<string> {
  const payee = input.payeeName?.trim() ?? "";
  if (!isTransferPayee(payee)) return createManualTransaction(input);

  const name = payee.slice(payee.indexOf(":") + 1).trim();
  const matches = accounts.filter((account) => account.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
  if (!name || matches.length !== 1) throw new Error("Choose an exact transfer account using Transfer → Other account.");
  const counterpart = matches[0]!;
  if (counterpart.id === input.accountId) throw new Error("A transfer needs two different accounts.");
  if (counterpart.closed) throw new Error("Transfers cannot use a closed account.");
  const amount = BigInt(input.amount);
  return createManualTransfer({
    accountId: input.accountId,
    counterpartAccountId: counterpart.id,
    date: input.date,
    memo: input.memo,
    flagId: input.flagId,
    amount: (amount < 0n ? -amount : amount).toString(),
    direction: amount < 0n ? "outflow" : "inflow",
  });
}
