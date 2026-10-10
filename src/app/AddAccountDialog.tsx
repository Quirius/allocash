import { useEffect, useRef, useState, type FormEvent } from "react";
import { createBudgetAccount, hasSavedMutationPending, type AccountKind } from "../lib/desktop";
import { localCalendarDate, parseSignedHufInput } from "../lib/format";
import { AmountInput } from "./AmountInput";

type AccountTypeOption = { label: string; kind: AccountKind };
const accountTypes: AccountTypeOption[] = [
  { label: "Checking", kind: "cash" }, { label: "Savings", kind: "cash" }, { label: "Cash", kind: "cash" },
  { label: "Credit Card", kind: "credit" }, { label: "Line of Credit", kind: "credit" },
  { label: "Mortgage", kind: "loan" }, { label: "Auto Loan", kind: "loan" }, { label: "Student Loan", kind: "loan" },
  { label: "Personal Loan", kind: "loan" }, { label: "Medical Debt", kind: "loan" }, { label: "Other Debt", kind: "loan" },
  { label: "Asset", kind: "tracking" }, { label: "Liability", kind: "tracking" },
];
const typeGroups: Array<{ kind: AccountKind; title: string; description: string }> = [
  { kind: "cash", title: "Cash", description: "Checking, savings and cash accounts" },
  { kind: "credit", title: "Credit", description: "Credit cards and lines of credit" },
  { kind: "loan", title: "Loans", description: "Money you owe" },
  { kind: "tracking", title: "Tracking", description: "Assets and liabilities outside the budget" },
];

export function AddAccountDialog({ pending, onCreated, onClose }: { pending: boolean; onCreated: (id: string) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [step, setStep] = useState<"details" | "type">("details");
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("0");
  const [type, setType] = useState<AccountTypeOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = pending || busy || committed;
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function refreshCreated(id: string) {
    try { await onCreated(id); onClose(); }
    catch { setError("Account was created, but the account list could not refresh. Retry the refresh below."); }
  }
  async function retryRefresh() {
    if (!createdId || pending || busy || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await onCreated(createdId); onClose(); }
    catch { setError("Account was created, but the account list could not refresh. Retry the refresh below."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || lock.current || hasSavedMutationPending() || !type) return;
    const trimmed = name.trim();
    if (!trimmed || Array.from(trimmed).length > 200) { setError("Enter an account nickname of 1 to 200 characters."); return; }
    let amount: string;
    try { amount = parseSignedHufInput(balance).toString(); }
    catch { setError("Enter a whole HUF starting balance or a valid calculation."); return; }
    lock.current = true; setBusy(true); setError(null);
    try {
      const id = await createBudgetAccount({ name: trimmed, kind: type.kind, balance: amount, asOf: localCalendarDate() });
      setCreatedId(id); setCommitted(true);
      await refreshCreated(id);
    } catch (cause) {
      setError(typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "Could not create the account.");
    } finally { lock.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className="add-account-dialog" aria-labelledby="add-account-title" onCancel={(event) => { event.preventDefault(); if (!busy && !pending) onClose(); }}>
    <header><h2 id="add-account-title">Add Account</h2><button type="button" aria-label="Close add account" disabled={busy || pending} onClick={onClose}>×</button></header>
    <form onSubmit={submit}>
      {step === "details" ? <>
        <label>Account Nickname<input autoFocus required maxLength={200} value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label>
        <button type="button" disabled={disabled} onClick={() => { setError(null); setStep("type"); }}>Choose account type{type ? `: ${type.label}` : ""}</button>
        {type && <p className="add-account-selected-type">{type.label}</p>}
        <label>Starting Balance<AmountInput aria-label="Starting Balance" required value={balance} disabled={disabled} onChange={(event) => setBalance(event.target.value)} inputMode="numeric" /><small>Enter debt balances as negative amounts. The amount is saved as entered.</small></label>
      </> : <section className="add-account-type-picker" aria-label="Choose account type">
        <h3>Choose account type</h3>
        {typeGroups.map((group) => <div className="add-account-type-group" key={group.kind}>
          <h4>{group.title}</h4><p>{group.description}</p>
          <div>{accountTypes.filter((option) => option.kind === group.kind).map((option) => <button key={option.label} type="button" disabled={disabled} aria-pressed={type?.label === option.label} onClick={() => { setType(option); setStep("details"); setError(null); }}>{option.label}</button>)}</div>
        </div>)}
      </section>}
      {error && <p className="add-account-error" role="alert">{error}</p>}
      {committed && <button type="button" disabled={busy || pending} onClick={() => void retryRefresh()}>Retry refresh</button>}
      <footer>
        {step === "type" ? <button type="button" disabled={disabled} onClick={() => setStep("details")}>Back</button> : <button type="button" disabled={busy || pending} onClick={onClose}>Cancel</button>}
        {step === "details" && <button type="submit" disabled={disabled || !name.trim() || !type}>{busy ? "Creating…" : "Add Account"}</button>}
      </footer>
    </form>
  </dialog>;
}
