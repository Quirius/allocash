import { useEffect, useRef, useState, type FormEvent } from "react";
import { deleteClosedAccount, editAccount, hasSavedMutationPending, loadAccountDetails, setAccountClosed, type AccountDetails } from "../lib/desktop";
import { localCalendarDate, parseSignedHufInput } from "../lib/format";
import { AmountInput } from "./AmountInput";

export function AccountEditor({ accountId, pending, onChanged, onClose }: { accountId: string; pending: boolean; onChanged: () => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nickname = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [asOf] = useState(localCalendarDate);
  const [details, setDetails] = useState<AccountDetails | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [balance, setBalance] = useState("");
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    let active = true;
    loadAccountDetails(accountId, asOf).then((value) => {
      if (!active) return;
      if (!value) { setError("Account editing is available in the desktop app."); return; }
      setDetails(value); setName(value.name); setNotes(value.notes); setBalance(value.workingBalance);
    }).catch(() => { if (active) setError("Could not load this account. Close this editor and try again."); });
    return () => { active = false; };
  }, [accountId, asOf]);
  useEffect(() => { if (details) { nickname.current?.focus(); nickname.current?.select(); } }, [details]);
  const disabled = busy || pending || committed;
  async function refresh() {
    try { await onChanged(); onClose(); }
    catch { setError("Changes were saved, but the account list could not refresh. Retry the refresh below."); }
  }
  async function mutate(operation: () => Promise<void>) {
    if (disabled || lock.current || hasSavedMutationPending()) return;
    lock.current = true; setBusy(true); setError(null);
    try { await operation(); setCommitted(true); await refresh(); }
    catch (cause) { setError(typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "Could not save account changes."); }
    finally { lock.current = false; setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!details) return;
    const trimmed = name.trim();
    if (!trimmed || Array.from(trimmed).length > 200) { setError("Enter an account nickname of 1 to 200 characters."); return; }
    let nextBalance: string | null = null;
    try { if (!details.closed) nextBalance = parseSignedHufInput(balance).toString(); }
    catch { setError("Enter a whole HUF working balance or a valid calculation."); return; }
    void mutate(() => editAccount({ accountId, name: trimmed, notes, asOf, expectedWorkingBalance: details.workingBalance, workingBalance: nextBalance }));
  }
  const empty = !!details && details.transactionCount === 0 && details.transferCount === 0;
  return <dialog ref={dialog} className="account-editor" aria-labelledby="account-editor-title" onCancel={(event) => { event.preventDefault(); if (!busy && !pending) onClose(); }}>
    <header><h2 id="account-editor-title">Edit Account</h2><button type="button" aria-label="Close account editor" disabled={busy || pending} onClick={onClose}>×</button></header>
    {!details ? <p role="status">{error ?? "Loading account…"}</p> : <form onSubmit={save}>
      <fieldset disabled={disabled}><legend>Account Information</legend>
        <label>Account Nickname<input ref={nickname} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Account Notes<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        {!details.closed && <label className="account-working-balance">Working Balance<AmountInput value={balance} onChange={(event) => setBalance(event.target.value)} /><small>An adjustment transaction will be created if you change this amount.</small></label>}
      </fieldset>
      {details.closed && !empty && <p className="account-delete-help">Delete all {details.transactionCount} transactions in this account and its {details.transferCount} linked transfers before deleting the account. Deleting a transfer also removes the other account’s entry and can change Plan values.</p>}
      {confirmDelete && <section className="account-delete-confirm" role="alert"><strong>Delete {details.name}?</strong><p>This removes the empty closed account, its notes, payment mapping and {details.scheduleCount} saved repeat rules. A local backup will be created. You can undo this action.</p><div><button type="button" disabled={disabled} onClick={() => setConfirmDelete(false)}>Keep account</button><button type="button" className="danger" disabled={disabled || !empty} onClick={() => void mutate(() => deleteClosedAccount(accountId))}>Delete account</button></div></section>}
      {error && <p className="editor-error" role="alert">{error}</p>}
      {committed && <button type="button" disabled={busy || pending} onClick={() => void refresh()}>Retry refresh</button>}
      <footer><div><button type="button" disabled={disabled} onClick={() => void mutate(() => setAccountClosed(accountId, !details.closed))}>{details.closed ? "Re-open" : "Close Account"}</button>{details.closed && <button type="button" className="danger" disabled={disabled || !empty} onClick={() => setConfirmDelete(true)}>Delete</button>}</div><div><button type="button" disabled={busy || pending} onClick={onClose}>Cancel</button><button disabled={disabled || !name.trim()}>{busy ? "Saving…" : "Save"}</button></div></footer>
    </form>}
    {!details && <button type="button" onClick={onClose}>Cancel</button>}
  </dialog>;
}
