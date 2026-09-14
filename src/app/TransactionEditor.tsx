import { useState, type FormEvent } from "react";
import {
  createManualTransaction,
  createManualTransfer,
  deleteRegisterEntry,
  RECONCILED_CONFIRMATION_REQUIRED,
  updateRegisterEntry,
  type AccountOverview,
  type RegisterEntry,
  type TransactionFormOptions,
} from "../lib/desktop";
import { localCalendarDate, parseHufInput } from "../lib/format";

function errorText(error: unknown): string {
  if (typeof error === "string" && error !== RECONCILED_CONFIRMATION_REQUIRED) return error;
  if (error instanceof Error) return error.message;
  return "The transaction could not be saved.";
}

function signedAmount(outflow: string, inflow: string) {
  if (outflow.trim() && inflow.trim()) {
    throw new Error("Enter either an outflow or an inflow, not both.");
  }
  if (!outflow.trim() && !inflow.trim()) {
    throw new Error("Enter an outflow or inflow amount.");
  }
  if (outflow.trim()) {
    const amount = parseHufInput(outflow);
    return { amount: (-amount).toString(), positive: amount.toString(), direction: "outflow" as const };
  }
  const amount = parseHufInput(inflow);
  return { amount: amount.toString(), positive: amount.toString(), direction: "inflow" as const };
}

export function TransactionComposer({
  account,
  accounts,
  options,
  onSaved,
  onCancel,
}: {
  account: AccountOverview;
  accounts: AccountOverview[];
  options: TransactionFormOptions;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<"transaction" | "transfer">("transaction");
  const [date, setDate] = useState(localCalendarDate());
  const [payee, setPayee] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [counterpartId, setCounterpartId] = useState("");
  const [memo, setMemo] = useState("");
  const [flagId, setFlagId] = useState("");
  const [outflow, setOutflow] = useState("");
  const [inflow, setInflow] = useState("");
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
      const parsed = signedAmount(outflow, inflow);
      setStatus("saving");
      if (kind === "transfer") {
        if (!counterpartId) throw new Error("Choose the other transfer account.");
        await createManualTransfer({
          accountId: account.id,
          counterpartAccountId: counterpartId,
          date,
          memo,
          flagId: flagId || null,
          amount: parsed.positive,
          direction: parsed.direction,
        });
      } else {
        await createManualTransaction({
          accountId: account.id,
          date,
          payeeName: payee.trim() || null,
          categoryId: categoryId || null,
          memo,
          flagId: flagId || null,
          amount: parsed.amount,
        });
      }
      await onSaved();
      onCancel();
    } catch (caught) {
      setError(errorText(caught));
      setStatus("editing");
    }
  }

  const openCounterparts = accounts.filter((item) => !item.closed && item.id !== account.id);

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
        <label>Date<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
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
              {options.payees.map((option) => <option key={option.id} value={option.name} />)}
            </datalist>
          </label>
          <label>Category
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Uncategorized</option>
              {options.categories.map((option) => (
                <option key={option.id} value={option.id}>{option.groupName} / {option.name}</option>
              ))}
            </select>
          </label>
        </> : (
          <label className="wide-field">Other account
            <select required autoFocus value={counterpartId} onChange={(event) => setCounterpartId(event.target.value)}>
              <option value="">Choose account…</option>
              {openCounterparts.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
        )}
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
          {error || (kind === "transfer" ? "The entered side will be Cleared; its counterpart will be Uncleared." : "New manual transactions default to Cleared.")}
        </p>
        <div><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Save transaction"}</button></div>
      </div>
    </form>
  );
}

export function RegisterEntryEditor({
  entry,
  onSaved,
  onCancel,
}: {
  entry: RegisterEntry;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const initialAmount = BigInt(entry.amount);
  const direction = initialAmount < 0n ? "outflow" : "inflow";
  const [amount, setAmount] = useState((initialAmount < 0n ? -initialAmount : initialAmount).toString());
  const [memo, setMemo] = useState(entry.memo);
  const [clearedState, setClearedState] = useState(entry.clearedState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(confirmed: boolean) {
    setError(null);
    setSaving(true);
    try {
      const positive = parseHufInput(amount);
      await updateRegisterEntry({
        id: entry.id,
        memo,
        amount: (direction === "outflow" ? -positive : positive).toString(),
        clearedState,
        confirmed,
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
    if (!window.confirm(entry.transferId ? "Delete both sides of this transfer?" : "Delete this transaction?")) return;
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
        <div><span>EDIT ENTRY</span><h3>{entry.transferAccountName ? `Transfer: ${entry.transferAccountName}` : entry.payeeName || "No payee"}</h3></div>
        {entry.transferId && <span className="paired-badge">Paired transfer</span>}
      </div>
      <div className="editor-fields edit-fields">
        <label>{direction === "outflow" ? "Outflow" : "Inflow"}<input autoFocus required inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Cleared state
          <select value={clearedState} onChange={(event) => setClearedState(event.target.value as RegisterEntry["clearedState"])}>
            <option value="uncleared">Uncleared</option>
            <option value="cleared">Cleared</option>
            <option value="reconciled">Reconciled</option>
          </select>
        </label>
        <label className="memo-field">Memo<input value={memo} onChange={(event) => setMemo(event.target.value)} /></label>
      </div>
      <div className="editor-footer">
        <button type="button" className="danger" disabled={saving} onClick={remove}>Delete</button>
        <p className={error ? "form-error" : "form-hint"} role={error ? "alert" : undefined}>{error || (entry.transferId ? "Amount changes update both linked sides." : "Memo-only edits never require reconciliation confirmation.")}</p>
        <div><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
      </div>
    </form>
  );
}
