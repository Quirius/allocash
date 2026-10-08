import { useState, type FormEvent } from "react";
import {
  createManualTransfer,
  deleteRegisterEntry,
  RECONCILED_CONFIRMATION_REQUIRED,
  updateRegisterEntry,
  type AccountOverview,
  type RegisterEntry,
  type TransactionFormOptions,
} from "../lib/desktop";
import { formatDate, localCalendarDate, parseHufInput, parseSignedHufInput } from "../lib/format";
import { createPayeeEntry, createScheduledPayeeEntry, isTransferPayee, scheduleForEntry, type EntryRepeat } from "../lib/transaction";
import { DateRepeatPicker, nextCalendarMonth } from "./DateRepeatPicker";

export interface TransactionDraft {
  kind: "transaction" | "transfer";
  date: string;
  repeat: EntryRepeat;
  payee: string;
  categoryId: string;
  counterpartId: string;
  memo: string;
  flagId: string;
  outflow: string;
  inflow: string;
}

export function draftFromPostedEntry(entry: RegisterEntry, sourceAccountId: string, accounts: AccountOverview[]): TransactionDraft {
  let counterpartId = "";
  if (entry.transferId) {
    if (entry.transferAccountId) {
      const counterpart = accounts.find((account) => account.id === entry.transferAccountId);
      if (!counterpart || counterpart.id === sourceAccountId) throw new Error("The transfer destination account is unavailable.");
      if (counterpart.closed) throw new Error("The transfer destination is closed and cannot receive a new schedule.");
      counterpartId = counterpart.id;
    } else {
      const matches = accounts.filter((account) => account.id !== sourceAccountId && account.name === entry.transferAccountName);
      if (matches.length !== 1) throw new Error("The transfer destination cannot be identified uniquely.");
      if (matches[0]!.closed) throw new Error("The transfer destination is closed and cannot receive a new schedule.");
      counterpartId = matches[0]!.id;
    }
  }
  const amount = BigInt(entry.amount);
  const magnitude = (amount < 0n ? -amount : amount).toString();
  return {
    kind: entry.transferId ? "transfer" : "transaction",
    date: nextCalendarMonth(entry.date), repeat: "monthly",
    payee: entry.payeeName || "", categoryId: entry.categoryId || "", counterpartId,
    memo: entry.memo, flagId: entry.flagId || "",
    outflow: amount < 0n ? magnitude : "", inflow: amount >= 0n ? magnitude : "",
  };
}

function errorText(error: unknown): string {
  if (typeof error === "string" && error !== RECONCILED_CONFIRMATION_REQUIRED) return error;
  if (error instanceof Error) return error.message;
  return "The transaction could not be saved.";
}

export function signedAmount(outflow: string, inflow: string) {
  if (outflow.trim() && inflow.trim()) {
    throw new Error("Enter either an outflow or an inflow, not both.");
  }
  if (!outflow.trim() && !inflow.trim()) {
    throw new Error("Enter an outflow or inflow amount.");
  }
  if (outflow.trim()) {
    const amount = parseSignedHufInput(`-${outflow.trim()}`);
    if (amount >= 0n) throw new Error("The amount must be greater than zero.");
    return { amount: amount.toString(), positive: (-amount).toString(), direction: "outflow" as const };
  }
  const amount = parseHufInput(inflow);
  return { amount: amount.toString(), positive: amount.toString(), direction: "inflow" as const };
}

export function TransactionComposer({
  account,
  accounts,
  options,
  initialDraft,
  onSaved,
  onCancel,
}: {
  account: AccountOverview;
  accounts: AccountOverview[];
  options: TransactionFormOptions;
  initialDraft?: TransactionDraft;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<"transaction" | "transfer">(initialDraft?.kind ?? "transaction");
  const [date, setDate] = useState(initialDraft?.date ?? localCalendarDate());
  const [repeat, setRepeat] = useState<EntryRepeat>(initialDraft?.repeat ?? "never");
  const [payee, setPayee] = useState(initialDraft?.payee ?? "");
  const [categoryId, setCategoryId] = useState(initialDraft?.categoryId ?? "");
  const [counterpartId, setCounterpartId] = useState(initialDraft?.counterpartId ?? "");
  const [memo, setMemo] = useState(initialDraft?.memo ?? "");
  const [flagId, setFlagId] = useState(initialDraft?.flagId ?? "");
  const [outflow, setOutflow] = useState(initialDraft?.outflow ?? "");
  const [inflow, setInflow] = useState(initialDraft?.inflow ?? "");
  const [status, setStatus] = useState<"editing" | "saving">("editing");
  const [error, setError] = useState<string | null>(null);

  function applyPayeeDefaults(name: string) {
    const match = options.payees.find(
      (option) => option.name.localeCompare(name.trim(), undefined, { sensitivity: "accent" }) === 0,
    );
    if (match?.lastCategoryId && !categoryId) setCategoryId(match.lastCategoryId);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      formatDate(date);
      const parsed = signedAmount(outflow, inflow);
      setStatus("saving");
      const schedule = scheduleForEntry(date, repeat, localCalendarDate());
      if (kind === "transfer") {
        if (!counterpartId) throw new Error("Choose the other transfer account.");
        if (BigInt(parsed.positive) > 9223372036854775807n) throw new Error("Transfer amounts must fit the supported positive HUF range.");
        if (schedule) {
          await createScheduledPayeeEntry({ accountId: account.id, counterpartAccountId: counterpartId, startDate: date, endDate: schedule.endDate,
            payeeName: null, categoryId: categoryId || null, memo, flagId: flagId || null, amount: parsed.amount, intervalMonths: schedule.intervalMonths }, accounts);
        } else {
          await createManualTransfer({
            accountId: account.id,
            counterpartAccountId: counterpartId,
            date,
            memo,
            flagId: flagId || null,
            amount: parsed.positive,
            direction: parsed.direction,
          });
        }
      } else {
        const input = {
          accountId: account.id,
          date,
          payeeName: payee.trim() || null,
          categoryId: categoryId || null,
          memo,
          flagId: flagId || null,
          amount: parsed.amount,
        };
        if (schedule) await createScheduledPayeeEntry({ ...input, startDate: date, endDate: schedule.endDate, intervalMonths: schedule.intervalMonths }, accounts);
        else await createPayeeEntry(input, accounts);
      }
      await onSaved();
      onCancel();
    } catch (caught) {
      setError(errorText(caught));
      setStatus("editing");
    }
  }

  const openCounterparts = accounts.filter((item) => !item.closed && item.id !== account.id);
  const transferPayee = kind === "transaction" && isTransferPayee(payee);
  const scheduled = scheduleForEntry(date, repeat, localCalendarDate()) !== null;

  return (
    <form className="transaction-editor" onSubmit={submit}>
      <div className="editor-heading">
        <div><span>NEW ENTRY</span><h3>Add transaction</h3></div>
        <div className="entry-kind" role="group" aria-label="Entry type">
          <button type="button" className={kind === "transaction" ? "active" : ""} onClick={() => setKind("transaction")}>Transaction</button>
          <button type="button" className={kind === "transfer" ? "active" : ""} onClick={() => setKind("transfer")}>Transfer</button>
        </div>
      </div>

      <div className="editor-fields">
        <DateRepeatPicker date={date} onDateChange={setDate} repeat={repeat} onRepeatChange={setRepeat} disabled={status === "saving"} />
        {kind === "transaction" ? <>
          <label>Payee
            <input
              autoFocus
              list={`payees-${account.id}`}
              value={payee}
              onChange={(event) => setPayee(event.target.value)}
              onBlur={(event) => applyPayeeDefaults(event.target.value)}
              placeholder="Name or new payee"
            />
            <datalist id={`payees-${account.id}`}>
              {openCounterparts.map((option) => <option key={`transfer-${option.id}`} value={`Transfer: ${option.name}`} />)}
              {options.payees.filter((option) => !isTransferPayee(option.name)).map((option) => <option key={option.id} value={option.name} />)}
            </datalist>
          </label>
          <label>Category
            <select disabled={transferPayee && !scheduled} value={transferPayee && !scheduled ? "" : categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Uncategorized</option>
              {categoryId && !options.categories.some((option) => option.id === categoryId) && <option value={categoryId}>{categoryId === initialDraft?.categoryId ? "Existing hidden category" : "Unavailable category"}</option>}
              {options.categories.map((option) => (
                <option key={option.id} value={option.id}>{option.groupName} / {option.name}</option>
              ))}
            </select>
          </label>
        </> : (
          <label>Other account
            <select required autoFocus value={counterpartId} onChange={(event) => setCounterpartId(event.target.value)}>
              <option value="">Choose account…</option>
              {openCounterparts.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
        )}
        {(kind === "transfer" && scheduled) && <label>Category
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorized</option>
            {categoryId && !options.categories.some((option) => option.id === categoryId) && <option value={categoryId}>{categoryId === initialDraft?.categoryId ? "Existing hidden category" : "Unavailable category"}</option>}
            {options.categories.map((option) => <option key={option.id} value={option.id}>{option.groupName} / {option.name}</option>)}
          </select>
        </label>}
        <label className="memo-field">Memo<input value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Optional note" /></label>
        <label>Flag
          <select value={flagId} onChange={(event) => setFlagId(event.target.value)}>
            <option value="">No flag</option>
            {options.flags.map((option) => (
              <option key={option.id} value={option.id}>{option.color} {option.name && `— ${option.name}`}</option>
            ))}
          </select>
        </label>
        <label>Outflow<input inputMode="numeric" value={outflow} onChange={(event) => { setOutflow(event.target.value); if (event.target.value) setInflow(""); }} placeholder="0 Ft" /></label>
        <label>Inflow<input inputMode="numeric" value={inflow} onChange={(event) => { setInflow(event.target.value); if (event.target.value) setOutflow(""); }} placeholder="0 Ft" /></label>
      </div>

      <div className="editor-footer">
        <p className={error ? "form-error" : "form-hint"} role={error ? "alert" : undefined}>
          {error || (scheduled ? "Scheduled entries are pending and Uncleared until they are posted." : kind === "transfer" || transferPayee ? "Saving creates both linked transfer entries. The entered side will be Cleared; its counterpart will be Uncleared." : "New manual transactions default to Cleared.")}
        </p>
        <div><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Save transaction"}</button></div>
      </div>
    </form>
  );
}

export function RegisterEntryEditor({
  entry,
  account,
  accounts,
  options,
  onMakeRepeating,
  onSaved,
  onCancel,
}: {
  entry: RegisterEntry;
  account: AccountOverview;
  accounts: AccountOverview[];
  options: TransactionFormOptions;
  onMakeRepeating: () => void;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const initialAmount = BigInt(entry.amount);
  const [direction, setDirection] = useState<"outflow" | "inflow">(initialAmount < 0n ? "outflow" : "inflow");
  const [amount, setAmount] = useState((initialAmount < 0n ? -initialAmount : initialAmount).toString());
  const [accountId, setAccountId] = useState(account.id);
  const [date, setDate] = useState(entry.date);
  const [payee, setPayee] = useState(entry.payeeName || "");
  const [categoryId, setCategoryId] = useState(entry.categoryId || "");
  const [memo, setMemo] = useState(entry.memo);
  const [flagId, setFlagId] = useState(entry.flagId || "");
  const [clearedState, setClearedState] = useState(entry.clearedState);
  const scheduled = !!entry.scheduleId && entry.postingState === "scheduled";
  const [repeatIntervalMonths, setRepeatIntervalMonths] = useState<0 | 1 | 3 | 12>(
    entry.repeatIntervalMonths === 1 || entry.repeatIntervalMonths === 3 || entry.repeatIntervalMonths === 12 ? entry.repeatIntervalMonths : 0,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(confirmed: boolean) {
    setError(null);
    setSaving(true);
    try {
      formatDate(date);
      const positive = parseHufInput(amount);
      await updateRegisterEntry({
        id: entry.id,
        accountId: entry.transferId ? null : accountId,
        date,
        payeeName: entry.transferId ? null : payee.trim() || null,
        categoryId: categoryId || null,
        memo,
        flagId: flagId || null,
        amount: (direction === "outflow" ? -positive : positive).toString(),
        clearedState: scheduled ? "uncleared" : clearedState,
        confirmed,
        ...(scheduled ? { repeatIntervalMonths } : {}),
      });
      await onSaved();
      onCancel();
    } catch (caught) {
      if (caught === RECONCILED_CONFIRMATION_REQUIRED && !confirmed) {
        const approved = window.confirm("This change affects reconciled history. Apply it anyway?");
        if (approved) return save(true);
        setSaving(false);
        return;
      }
      setError(errorText(caught));
      setSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save(false);
  }

  async function remove() {
    const deletePrompt = scheduled
      ? "Delete this upcoming entry and stop its repeats?"
      : entry.transferId ? "Delete both sides of this transfer?" : "Delete this transaction?";
    if (!window.confirm(deletePrompt)) return;
    setError(null);
    setSaving(true);
    try {
      await deleteRegisterEntry(entry.id, false);
      await onSaved();
      onCancel();
    } catch (caught) {
      if (caught === RECONCILED_CONFIRMATION_REQUIRED) {
        const approved = window.confirm("This deletion affects reconciled history. Delete it anyway?");
        if (approved) {
          try {
            await deleteRegisterEntry(entry.id, true);
            await onSaved();
            onCancel();
            return;
          } catch (confirmedError) {
            setError(errorText(confirmedError));
          }
        }
      } else {
        setError(errorText(caught));
      }
      setSaving(false);
    }
  }

  return (
    <form className="transaction-editor compact" onSubmit={submit}>
      <div className="editor-heading">
        <div><span>EDIT ENTRY</span><h3>{entry.transferAccountName ? `Transfer: ${entry.transferAccountName}` : entry.payeeName || "No payee"}</h3>
          {scheduled && <p>Changes apply to this upcoming entry and future repeats. Posted history is unchanged.</p>}
        </div>
        {entry.transferId && <span className="paired-badge">Paired transfer</span>}
      </div>
      <div className="editor-fields edit-fields">
        {!entry.transferId && <label>Account
          <select autoFocus value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.filter((option) => !option.closed || option.id === account.id).map((option) =>
              <option key={option.id} value={option.id}>{option.name}{option.closed ? " (closed)" : ""}</option>)}
          </select>
        </label>}
        <div className="editor-date-field">
        <DateRepeatPicker date={date} onDateChange={setDate} {...(scheduled ? { repeat: repeatIntervalMonths === 1 ? "monthly" as const : repeatIntervalMonths === 3 ? "quarterly" as const : repeatIntervalMonths === 12 ? "yearly" as const : "never" as const, onRepeatChange: (value: EntryRepeat) => setRepeatIntervalMonths(value === "monthly" ? 1 : value === "quarterly" ? 3 : value === "yearly" ? 12 : 0) } : {})} disabled={saving} />
          {entry.postingState === "posted" && entry.date <= localCalendarDate() && <button type="button" className="secondary" disabled={saving} onClick={onMakeRepeating}>Make repeating</button>}
        </div>
        {!entry.transferId && <label>Payee
          <input list={`edit-payees-${entry.id}`} value={payee} onChange={(event) => setPayee(event.target.value)} />
          <datalist id={`edit-payees-${entry.id}`}>
            {options.payees.map((option) => <option key={option.id} value={option.name} />)}
          </datalist>
        </label>}
        <label>Category
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Uncategorized</option>
            {entry.categoryId && !options.categories.some((option) => option.id === entry.categoryId) &&
              <option value={entry.categoryId}>{entry.categoryGroupName} / {entry.categoryName} (hidden)</option>}
            {options.categories.map((option) => <option key={option.id} value={option.id}>{option.groupName} / {option.name}</option>)}
          </select>
        </label>
        {!entry.transferId && <label>Direction
          <select value={direction} onChange={(event) => setDirection(event.target.value as "outflow" | "inflow")}>
            <option value="outflow">Outflow</option><option value="inflow">Inflow</option>
          </select>
        </label>}
        <label>Amount<input required inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Cleared state
          <select disabled={scheduled} value={scheduled ? "uncleared" : clearedState} onChange={(event) => setClearedState(event.target.value as RegisterEntry["clearedState"])}>
            <option value="uncleared">Uncleared</option>
            <option value="cleared">Cleared</option>
            <option value="reconciled">Reconciled</option>
          </select>
        </label>
        <label className="memo-field">Memo<input value={memo} onChange={(event) => setMemo(event.target.value)} /></label>
        <label>Flag
          <select value={flagId} onChange={(event) => setFlagId(event.target.value)}>
            <option value="">No flag</option>
            {options.flags.map((option) => <option key={option.id} value={option.id}>{option.color} {option.name}</option>)}
          </select>
        </label>
      </div>
      <div className="editor-footer">
        <div className="edit-actions"><button type="button" className="danger" disabled={saving} onClick={remove}>Delete</button></div>
        <p className={error ? "form-error" : "form-hint"} role={error ? "alert" : undefined}>{error || (entry.transferId ? "Amount changes update both linked sides." : "Memo-only edits never require reconciliation confirmation.")}</p>
        <div><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
      </div>
    </form>
  );
}
