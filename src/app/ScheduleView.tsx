import { useEffect, useState, type FormEvent } from "react";
import { deactivateSchedule, loadScheduledOccurrences, postScheduledOccurrence, skipScheduledOccurrence, type AccountOverview, type ScheduledOccurrence, type TransactionFormOptions, type RecurrenceMonths } from "../lib/desktop";
import { formatDate, formatHuf, localCalendarDate, parseSignedHufInput } from "../lib/format";
import { createScheduledPayeeEntry, isTransferPayee } from "../lib/transaction";
import { recurrenceLabel } from "../lib/recurrence";

export const SAFETY_BACKUP_ERROR = "Could not create the required safety backup. No changes were made.";

export function scheduleCancellationError(caught: unknown): string {
  return caught === SAFETY_BACKUP_ERROR ? SAFETY_BACKUP_ERROR : "This schedule could not be canceled.";
}

export function ScheduleView({ accounts, options }: { accounts: AccountOverview[]; options: TransactionFormOptions }) {
  const [items, setItems] = useState<ScheduledOccurrence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [startDate, setStartDate] = useState(localCalendarDate());
  const [endDate, setEndDate] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [memo, setMemo] = useState("");
  const [amount, setAmount] = useState("");
  const [intervalMonths, setIntervalMonths] = useState<RecurrenceMonths>(1);
  const [kind, setKind] = useState<"transaction" | "transfer">("transaction");
  const [counterpartId, setCounterpartId] = useState("");
  const activeAccounts = accounts.filter((account) => !account.closed);
  const selectedAccountId = activeAccounts.some((account) => account.id === accountId)
    ? accountId : activeAccounts[0]?.id ?? "";

  async function reload() {
    try {
      setItems(await loadScheduledOccurrences());
      setError(null);
    } catch {
      setError("Scheduled transactions could not be loaded. Try reopening this view.");
    }
  }
  useEffect(() => { void reload(); }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    let value: bigint;
    try {
      value = parseSignedHufInput(amount);
      if (!selectedAccountId || !startDate || (endDate && endDate < startDate) || value === 0n) throw new Error();
    } catch {
      setError("Choose an open account, valid date range, and non-zero whole HUF amount.");
      return;
    }
    try {
      if (kind === "transfer" && !counterpartId) throw new Error("Choose the other transfer account.");
      await createScheduledPayeeEntry({ accountId: selectedAccountId, startDate, endDate: endDate || null, payeeName: kind === "transfer" ? null : payeeName || null, categoryId: categoryId || null, memo, flagId: null, amount: value.toString(), intervalMonths, counterpartAccountId: kind === "transfer" ? counterpartId : null }, accounts);
      setAmount("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "This schedule could not be created.");
    }
  }
  async function finish(id: string, post: boolean) {
    try {
      if (post) await postScheduledOccurrence(id); else await skipScheduledOccurrence(id);
      await reload();
    } catch {
      setError("This scheduled occurrence could not be updated.");
    }
  }
  async function cancel(scheduleId: string) {
    try {
      await deactivateSchedule(scheduleId);
      await reload();
    } catch (caught) {
      setError(scheduleCancellationError(caught));
    }
  }

  return <section className="schedule-view">
    <div className="plan-toolbar"><div><p className="eyebrow">SCHEDULED TRANSACTIONS</p><h2>Schedules</h2></div></div>
    {error && <p className="editor-error" role="alert">{error}</p>}
    <form className="schedule-form" onSubmit={save}>
      <strong>New schedule</strong>
      <div className="entry-kind" role="group" aria-label="Scheduled entry type"><button type="button" className={kind === "transaction" ? "active" : ""} onClick={() => setKind("transaction")}>Transaction</button><button type="button" className={kind === "transfer" ? "active" : ""} onClick={() => setKind("transfer")}>Transfer</button></div>
      <select aria-label="Account" value={selectedAccountId} onChange={(event) => setAccountId(event.target.value)} disabled={!activeAccounts.length}>
        {activeAccounts.length === 0 && <option value="">No open accounts</option>}
        {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <input aria-label="Start date" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
      <input aria-label="End date" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} title="Optional end date" />
      <select aria-label="Repeat frequency" value={intervalMonths} onChange={(event) => setIntervalMonths(Number(event.target.value) as RecurrenceMonths)}><option value={1}>Monthly</option><option value={3}>Quarterly</option><option value={12}>Yearly</option></select>
      {kind === "transfer" ? <select aria-label="Other transfer account" required value={counterpartId} onChange={(event) => setCounterpartId(event.target.value)}><option value="">Other account</option>{activeAccounts.filter((account) => account.id !== selectedAccountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select> : <><input aria-label="Payee" list="scheduled-payees" value={payeeName} onChange={(event) => setPayeeName(event.target.value)} placeholder="Payee or Transfer: account" /><datalist id="scheduled-payees">{activeAccounts.filter((account) => account.id !== selectedAccountId).map((account) => <option key={`transfer-${account.id}`} value={`Transfer: ${account.name}`} />)}{options.payees.filter((payee) => !isTransferPayee(payee.name)).map((payee) => <option key={payee.id} value={payee.name} />)}</datalist></>}
      <select aria-label="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorized</option>{options.categories.map((category) => <option key={category.id} value={category.id}>{category.groupName} / {category.name}</option>)}</select>
      <input aria-label="Amount" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="HUF, - for outflow" inputMode="numeric" />
      <input aria-label="Memo" value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Memo" />
      <button disabled={!selectedAccountId}>Schedule</button>
    </form>
    {items === null ? <div className="register-message">{error ? "Schedules unavailable." : "Loading schedules…"}</div> : <div className="schedule-list">
      {items.length === 0 ? <p>No pending scheduled transactions.</p> : items.map((item) => <div key={item.transactionId}>
        <span><strong>{formatDate(item.date)}</strong> {item.accountName} · {item.transferAccountName ? `Transfer: ${item.transferAccountName}` : item.payeeName ?? "No payee"}<small>{recurrenceLabel(item.intervalMonths)} · {item.categoryName ?? "Uncategorized"}{item.memo && ` · ${item.memo}`}</small></span>
        <b>{formatHuf(BigInt(item.amount))}</b>
        <button onClick={() => void finish(item.transactionId, true)}>Post</button>
        <button onClick={() => void finish(item.transactionId, false)}>Skip</button>
        <button onClick={() => void cancel(item.scheduleId)}>Cancel</button>
      </div>)}
    </div>}
  </section>;
}
