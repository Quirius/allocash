import { AmountInput } from "./AmountInput";
import { useEffect, useState, type FormEvent } from "react";
import {
  createManualTransfer,
  deleteRegisterEntry,
  makeUpcomingRegisterEntryRepeating,
  RECONCILED_CONFIRMATION_REQUIRED,
  updateRegisterEntry,
  type AccountOverview,
  type RegisterEntry,
  type RegisterEntryEdit,
  type TransactionFormOptions,
} from "../lib/desktop";
import { formatDate, localCalendarDate, parseHufInput, parseSignedHufInput } from "../lib/format";
import { createPayeeEntry, createScheduledPayeeEntry, isTransferPayee, resolveTransferPayee, scheduleForEntry, type EntryRepeat } from "../lib/transaction";
import { categoryPolicy, inheritedReadyNeedsReset, readyToAssignCategoryId, transitionCategoryOrigin } from "../lib/categoryPolicy";
import { DateRepeatPicker, nextRepeatDate } from "./DateRepeatPicker";

export interface TransactionDraft {
  kind: "transaction" | "transfer";
  date: string;
  repeat: EntryRepeat;
  repeatDayOfMonth?: number;
  payee: string;
  categoryId: string;
  categoryGroupName?: string | null;
  categoryName?: string | null;
  counterpartId: string;
  memo: string;
  flagId: string;
  outflow: string;
  inflow: string;
}

export function draftFromPostedEntry(entry: RegisterEntry, sourceAccountId: string, accounts: AccountOverview[], today = localCalendarDate()): TransactionDraft {
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
    date: nextRepeatDate(entry.date, today), repeat: "monthly", repeatDayOfMonth: Number(entry.date.slice(8)),
    payee: entry.payeeName || "", categoryId: entry.categoryId || "", categoryGroupName: entry.categoryGroupName, categoryName: entry.categoryName, counterpartId,
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
    const amount = parseSignedHufInput(`-(${outflow.trim().replace(/\s*Ft$/i, "")})`);
    if (amount >= 0n) throw new Error("The amount must be greater than zero.");
    return { amount: amount.toString(), positive: (-amount).toString(), direction: "outflow" as const };
  }
  const amount = parseHufInput(inflow);
  return { amount: amount.toString(), positive: amount.toString(), direction: "inflow" as const };
}

export function canMakeUpcomingEntryRepeating(entry: RegisterEntry, asOfDate: string): boolean {
  return !entry.scheduleId && entry.postingState === "posted" && entry.date > asOfDate && entry.clearedState === "uncleared";
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
  const [categoryOrigin, setCategoryOrigin] = useState<"automatic-ready" | "explicit" | "existing" | "empty">(initialDraft?.categoryId ? "existing" : "empty");
  const [counterpartId, setCounterpartId] = useState(initialDraft?.counterpartId ?? "");
  const [memo, setMemo] = useState(initialDraft?.memo ?? "");
  const [flagId, setFlagId] = useState(initialDraft?.flagId ?? "");
  const [outflow, setOutflow] = useState(initialDraft?.outflow ?? "");
  const [inflow, setInflow] = useState(initialDraft?.inflow ?? "");
  const [status, setStatus] = useState<"editing" | "saving">("editing");
  const [error, setError] = useState<string | null>(null);

  const direction = inflow.trim() ? "inflow" : "outflow";
  let resolvedPayeeTransfer: AccountOverview | undefined;
  if (kind === "transaction" && isTransferPayee(payee)) {
    try {
      const id = resolveTransferPayee(payee, account.id, accounts);
      resolvedPayeeTransfer = accounts.find((item) => item.id === id);
    } catch { /* The save path reports incomplete or ambiguous transfer payees. */ }
  }
  const transferDestination = kind === "transfer"
    ? accounts.find((item) => item.id === counterpartId)
    : resolvedPayeeTransfer;
  const categoryRule = categoryPolicy(account, direction, transferDestination);
  const initialDirection = initialDraft ? (initialDraft.inflow.trim() ? "inflow" : "outflow") : null;
  const initialTransferDestination = initialDraft?.kind === "transfer"
    ? accounts.find((item) => item.id === initialDraft.counterpartId)
    : initialDraft && isTransferPayee(initialDraft.payee)
      ? (() => {
          try {
            const id = resolveTransferPayee(initialDraft.payee, account.id, accounts);
            return accounts.find((item) => item.id === id);
          } catch { return undefined; }
        })()
      : undefined;
  const initialCategoryRule = initialDirection ? categoryPolicy(account, initialDirection, initialTransferDestination) : null;
  const readyId = readyToAssignCategoryId(options.categories);

  useEffect(() => {
    if (inheritedReadyNeedsReset({
      origin: categoryOrigin, categoryId, initiallyDefaultedToReady: !!initialCategoryRule?.readyToAssignDefault,
      nextScopeVisible: categoryRule.show, nextRequiresChoice: categoryRule.required, readyToAssignId: readyId,
      categoryGroupName: initialDraft?.categoryGroupName, categoryName: initialDraft?.categoryName,
    })) {
      setCategoryId(""); setCategoryOrigin("empty");
      return;
    }
    const next = transitionCategoryOrigin({
      categoryId, origin: categoryOrigin, show: categoryRule.show, required: categoryRule.required,
      readyToAssignDefault: categoryRule.readyToAssignDefault, readyToAssignId: readyId, allowDefault: true,
    });
    if (next.categoryId !== categoryId) setCategoryId(next.categoryId);
    if (next.origin !== categoryOrigin) setCategoryOrigin(next.origin);
  }, [categoryId, categoryOrigin, categoryRule.required, categoryRule.show, initialCategoryRule?.readyToAssignDefault, readyId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      formatDate(date);
      const parsed = signedAmount(outflow, inflow);
      const applicableRule = categoryPolicy(account, parsed.direction, transferDestination);
      const submittedCategoryId = applicableRule.show ? categoryId || null : initialDraft?.categoryId ?? null;
      const inheritedReadyMustReset = inheritedReadyNeedsReset({
        origin: categoryOrigin, categoryId, initiallyDefaultedToReady: !!initialCategoryRule?.readyToAssignDefault,
        nextScopeVisible: applicableRule.show, nextRequiresChoice: applicableRule.required, readyToAssignId: readyId,
        categoryGroupName: initialDraft?.categoryGroupName, categoryName: initialDraft?.categoryName,
      });
      if (applicableRule.required && (!categoryId || categoryOrigin === "automatic-ready" || inheritedReadyMustReset)) throw new Error("Choose a category for this budget outflow.");
      setStatus("saving");
      const schedule = scheduleForEntry(date, repeat, localCalendarDate());
      const dayOfMonth = initialDraft && date === initialDraft.date && repeat !== "never" ? initialDraft.repeatDayOfMonth : undefined;
      if (kind === "transfer") {
        if (!counterpartId) throw new Error("Choose the other transfer account.");
        if (BigInt(parsed.positive) > 9223372036854775807n) throw new Error("Transfer amounts must fit the supported positive HUF range.");
        if (schedule) {
          await createScheduledPayeeEntry({ accountId: account.id, counterpartAccountId: counterpartId, startDate: date, endDate: schedule.endDate,
            payeeName: null, categoryId: submittedCategoryId, memo, flagId: flagId || null, amount: parsed.amount, intervalMonths: schedule.intervalMonths, ...(dayOfMonth ? { dayOfMonth } : {}) }, accounts);
        } else {
          await createManualTransfer({
            accountId: account.id,
            counterpartAccountId: counterpartId,
            date,
            memo,
            flagId: flagId || null,
            amount: parsed.positive,
            direction: parsed.direction,
            categoryId: submittedCategoryId,
          });
        }
      } else {
        const input = {
          accountId: account.id,
          date,
          payeeName: payee.trim() || null,
          categoryId: submittedCategoryId,
          memo,
          flagId: flagId || null,
          amount: parsed.amount,
        };
        if (schedule) await createScheduledPayeeEntry({ ...input, startDate: date, endDate: schedule.endDate, intervalMonths: schedule.intervalMonths, ...(dayOfMonth ? { dayOfMonth } : {}) }, accounts);
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
              placeholder="Name or new payee"
            />
            <datalist id={`payees-${account.id}`}>
              {openCounterparts.map((option) => <option key={`transfer-${option.id}`} value={`Transfer: ${option.name}`} />)}
              {options.payees.filter((option) => !isTransferPayee(option.name)).map((option) => <option key={option.id} value={option.name} />)}
            </datalist>
          </label>
          {categoryRule.show && <label>Category
            <select required={categoryRule.required} value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setCategoryOrigin(event.target.value ? "explicit" : "empty"); }}>
              <option value="">{categoryRule.readyToAssignDefault ? "Ready to Assign (automatic)" : "Choose category"}</option>
              {categoryId && !options.categories.some((option) => option.id === categoryId) && <option value={categoryId}>{categoryId === initialDraft?.categoryId ? "Existing hidden category" : "Unavailable category"}</option>}
              {options.categories.map((option) => (
                <option key={option.id} value={option.id}>{option.groupName} / {option.name}</option>
              ))}
            </select>
          </label>}
        </> : (
          <label>Other account
            <select required autoFocus value={counterpartId} onChange={(event) => setCounterpartId(event.target.value)}>
              <option value="">Choose account…</option>
              {openCounterparts.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
        )}
        {(kind === "transfer" && categoryRule.show) && <label>Category
          <select required={categoryRule.required} value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setCategoryOrigin(event.target.value ? "explicit" : "empty"); }}><option value="">{categoryRule.readyToAssignDefault ? "Ready to Assign (automatic)" : "Choose category"}</option>
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
        <label>Outflow<AmountInput inputMode="numeric" value={outflow} onChange={(event) => { setOutflow(event.target.value); if (event.target.value) setInflow(""); }} placeholder="0 Ft" /></label>
        <label>Inflow<AmountInput inputMode="numeric" value={inflow} onChange={(event) => { setInflow(event.target.value); if (event.target.value) setOutflow(""); }} placeholder="0 Ft" /></label>
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
  const [categoryOrigin, setCategoryOrigin] = useState<"automatic-ready" | "explicit" | "existing" | "empty">(entry.categoryId ? "existing" : "empty");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [memo, setMemo] = useState(entry.memo);
  const [flagId, setFlagId] = useState(entry.flagId || "");
  const [clearedState, setClearedState] = useState(entry.clearedState);
  const scheduled = !!entry.scheduleId && entry.postingState === "scheduled";
  const upcomingRepeatEligible = canMakeUpcomingEntryRepeating(entry, localCalendarDate());
  const [repeatIntervalMonths, setRepeatIntervalMonths] = useState<0 | 1 | 3 | 12>(
    entry.repeatIntervalMonths === 1 || entry.repeatIntervalMonths === 3 || entry.repeatIntervalMonths === 12 ? entry.repeatIntervalMonths : 0,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editAccount = accounts.find((option) => option.id === accountId) ?? account;
  const transferPeer = entry.transferId
    ? (entry.transferAccountId ? accounts.find((option) => option.id === entry.transferAccountId) : accounts.find((option) => option.id !== account.id && option.name === entry.transferAccountName))
    : undefined;
  const initialDirection = initialAmount < 0n ? "outflow" : "inflow";
  const editCategoryRule = categoryPolicy(editAccount, direction, transferPeer);
  const initialCategoryRule = categoryPolicy(account, initialDirection, transferPeer);
  const readyId = readyToAssignCategoryId(options.categories);
  const categoryEmptyLabel = editCategoryRule.required
    ? "Choose category"
    : editCategoryRule.readyToAssignDefault && (categoryTouched || direction !== initialDirection || accountId !== account.id)
      ? "Ready to Assign (automatic)"
      : "Uncategorized";

  useEffect(() => {
    const changed = direction !== initialDirection || accountId !== account.id;
    if (changed && inheritedReadyNeedsReset({
      origin: categoryOrigin, categoryId, initiallyDefaultedToReady: initialCategoryRule.readyToAssignDefault,
      nextScopeVisible: editCategoryRule.show, nextRequiresChoice: editCategoryRule.required, readyToAssignId: readyId,
      categoryGroupName: entry.categoryGroupName, categoryName: entry.categoryName,
    })) {
      setCategoryId(""); setCategoryOrigin("empty");
      return;
    }
    const next = transitionCategoryOrigin({
      categoryId, origin: categoryOrigin, show: editCategoryRule.show, required: editCategoryRule.required,
      readyToAssignDefault: editCategoryRule.readyToAssignDefault, readyToAssignId: readyId,
      allowDefault: categoryTouched || changed,
    });
    if (next.categoryId !== categoryId) setCategoryId(next.categoryId);
    if (next.origin !== categoryOrigin) setCategoryOrigin(next.origin);
  }, [account.id, accountId, categoryId, categoryOrigin, categoryTouched, direction, editCategoryRule.readyToAssignDefault, editCategoryRule.required, editCategoryRule.show, initialCategoryRule.readyToAssignDefault, initialDirection, readyId]);

  async function save(confirmed: boolean) {
    setError(null);
    setSaving(true);
    try {
      formatDate(date);
      const positive = parseHufInput(amount);
      const inheritedReadyMustReset = inheritedReadyNeedsReset({
        origin: categoryOrigin, categoryId, initiallyDefaultedToReady: initialCategoryRule.readyToAssignDefault,
        nextScopeVisible: editCategoryRule.show, nextRequiresChoice: editCategoryRule.required, readyToAssignId: readyId,
        categoryGroupName: entry.categoryGroupName, categoryName: entry.categoryName,
      });
      if (editCategoryRule.required && (!categoryId || categoryOrigin === "automatic-ready" || inheritedReadyMustReset) && (categoryTouched || direction !== initialDirection || accountId !== account.id)) {
        throw new Error("Choose a category for this budget outflow.");
      }
      const edit: RegisterEntryEdit = {
        id: entry.id,
        accountId: entry.transferId ? null : accountId,
        date,
        payeeName: entry.transferId ? null : payee.trim() || null,
        categoryId: editCategoryRule.show ? categoryId || null : entry.categoryId,
        memo,
        flagId: flagId || null,
        amount: (direction === "outflow" ? -positive : positive).toString(),
        clearedState: scheduled || (upcomingRepeatEligible && repeatIntervalMonths > 0) ? "uncleared" : clearedState,
        confirmed,
        ...(scheduled || (upcomingRepeatEligible && repeatIntervalMonths > 0) ? { repeatIntervalMonths } : {}),
      };
      if (upcomingRepeatEligible && repeatIntervalMonths > 0) {
        await makeUpcomingRegisterEntryRepeating(edit, localCalendarDate());
      } else {
        await updateRegisterEntry(edit);
      }
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
        <DateRepeatPicker date={date} onDateChange={setDate} {...(scheduled || upcomingRepeatEligible ? { repeat: repeatIntervalMonths === 1 ? "monthly" as const : repeatIntervalMonths === 3 ? "quarterly" as const : repeatIntervalMonths === 12 ? "yearly" as const : "never" as const, onRepeatChange: (value: EntryRepeat) => setRepeatIntervalMonths(value === "monthly" ? 1 : value === "quarterly" ? 3 : value === "yearly" ? 12 : 0) } : {})} disabled={saving} />
          {(scheduled || upcomingRepeatEligible) && repeatIntervalMonths === 0 && <button type="button" className="secondary" disabled={saving} onClick={() => setRepeatIntervalMonths(1)}>Make repeating</button>}
          {!scheduled && !upcomingRepeatEligible && entry.postingState === "posted" && entry.date <= localCalendarDate() && <button type="button" className="secondary" disabled={saving} onClick={onMakeRepeating}>Make repeating</button>}
        </div>
        {!entry.transferId && <label>Payee
          <input list={`edit-payees-${entry.id}`} value={payee} onChange={(event) => setPayee(event.target.value)} />
          <datalist id={`edit-payees-${entry.id}`}>
            {options.payees.map((option) => <option key={option.id} value={option.name} />)}
          </datalist>
        </label>}
        {editCategoryRule.show && <label>Category
          <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setCategoryOrigin(event.target.value ? "explicit" : "empty"); setCategoryTouched(true); }}>
            <option value="">{categoryEmptyLabel}</option>
            {entry.categoryId && !options.categories.some((option) => option.id === entry.categoryId) &&
              <option value={entry.categoryId}>{entry.categoryGroupName} / {entry.categoryName} (hidden)</option>}
            {options.categories.map((option) => <option key={option.id} value={option.id}>{option.groupName} / {option.name}</option>)}
          </select>
        </label>}
        {!entry.transferId && <label>Direction
          <select value={direction} onChange={(event) => setDirection(event.target.value as "outflow" | "inflow")}>
            <option value="outflow">Outflow</option><option value="inflow">Inflow</option>
          </select>
        </label>}
        <label>Amount<AmountInput required inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Cleared state
          <select disabled={scheduled || (upcomingRepeatEligible && repeatIntervalMonths > 0)} value={scheduled || (upcomingRepeatEligible && repeatIntervalMonths > 0) ? "uncleared" : clearedState} onChange={(event) => setClearedState(event.target.value as RegisterEntry["clearedState"])}>
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
