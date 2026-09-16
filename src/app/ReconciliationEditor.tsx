import { useEffect, useState } from "react";
import {
  RECONCILIATION_OUT_OF_DATE, loadAccountRegister, previewAccountReconciliation,
  reconcileAccount, updateRegisterEntry, type AccountOverview, type ReconciliationReview,
  type RegisterEntry,
} from "../lib/desktop";
import { formatDate, formatHuf, localCalendarDate, parseSignedHufInput } from "../lib/format";

export function reconciliationCandidates(entries: RegisterEntry[], asOf: string): RegisterEntry[] {
  return entries.filter((entry) => entry.postingState === "posted" && entry.date <= asOf && (entry.clearedState === "cleared" || entry.clearedState === "uncleared"));
}

function entryLabel(entry: RegisterEntry): string {
  return entry.transferAccountName ? `Transfer: ${entry.transferAccountName}` : entry.payeeName || "No payee";
}

export function ReconciliationEditor({ account, onSaved, onCancel }: {
  account: AccountOverview; onSaved: () => Promise<void>; onCancel: () => void;
}) {
  const [asOf, setAsOf] = useState(localCalendarDate());
  const [bankBalance, setBankBalance] = useState("");
  const [review, setReview] = useState<ReconciliationReview | null>(null);
  const [entries, setEntries] = useState<RegisterEntry[] | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const invalidate = () => { setReview(null); setError(null); };

  async function loadEntries() {
    const rows = await loadAccountRegister(account.id);
    if (rows === null) throw new Error("The desktop register is unavailable.");
    setEntries(rows);
    return rows;
  }

  useEffect(() => {
    let active = true;
    setEntries(null); setEntriesError(null);
    loadAccountRegister(account.id).then((rows) => {
      if (!active) return;
      if (rows === null) { setEntriesError("The desktop register is unavailable."); return; }
      setEntries(rows);
    }).catch(() => { if (active) setEntriesError("Could not load transactions for reconciliation."); });
    return () => { active = false; };
  }, [account.id]);

  async function reviewAccount() {
    try {
      setSaving(true); setError(null);
      const amount = parseSignedHufInput(bankBalance);
      setReview(await previewAccountReconciliation({ accountId: account.id, asOf, bankClearedBalance: amount.toString(), expectedClearedBalance: null }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review this account."); }
    finally { setSaving(false); }
  }

  async function toggleCandidate(entry: RegisterEntry) {
    if (!review) return;
    try {
      setSaving(true); setError(null);
      await updateRegisterEntry({ id: entry.id, memo: entry.memo, amount: entry.amount, clearedState: entry.clearedState === "cleared" ? "uncleared" : "cleared", confirmed: false });
      await loadEntries();
      setReview(await previewAccountReconciliation({ accountId: account.id, asOf, bankClearedBalance: review.bankClearedBalance, expectedClearedBalance: null }));
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this transaction."); }
    finally { setSaving(false); }
  }

  async function finish() {
    if (!review) return;
    try {
      setSaving(true); setError(null);
      await reconcileAccount({ accountId: account.id, asOf, bankClearedBalance: review.bankClearedBalance, expectedClearedBalance: review.appClearedBalance });
      await onSaved(); onCancel();
    } catch (cause) {
      if (cause === RECONCILIATION_OUT_OF_DATE) { setReview(null); setError("The account changed. Review it again before reconciling."); }
      else setError(cause instanceof Error ? cause.message : "Could not reconcile this account.");
    } finally { setSaving(false); }
  }

  const adjustment = review ? BigInt(review.adjustmentAmount) : 0n;
  const candidates = entries ? reconciliationCandidates(entries, asOf) : [];
  return <section className="transaction-editor reconciliation-editor" aria-labelledby="reconcile-title">
    <div className="editor-heading"><div><p className="eyebrow">RECONCILIATION</p><h2 id="reconcile-title">Reconcile {account.name}</h2></div><button className="text-button" onClick={onCancel} disabled={saving}>Cancel</button></div>
    <p className="editor-help">Enter the cleared balance shown by your bank, then match cleared transactions before creating an adjustment. Pending items stay uncleared.</p>
    <div className="editor-grid"><label>Through date<input type="date" value={asOf} onChange={(event) => { setAsOf(event.target.value); invalidate(); }} disabled={saving} /></label><label>Bank cleared balance<input value={bankBalance} onChange={(event) => { setBankBalance(event.target.value); invalidate(); }} placeholder="e.g. -12 500" inputMode="text" disabled={saving} /></label></div>
    {error && <p className="editor-error" role="alert">{error}</p>}
    {!review ? <button onClick={reviewAccount} disabled={saving}>{saving ? "Reviewing…" : "Review reconciliation"}</button> : <div className="reconciliation-review">
      <dl><div><dt>Allocash cleared</dt><dd>{formatHuf(BigInt(review.appClearedBalance))}</dd></div><div><dt>Bank cleared</dt><dd>{formatHuf(BigInt(review.bankClearedBalance))}</dd></div><div><dt>Entries to reconcile</dt><dd>{review.clearedEntryCount}</dd></div></dl>
      <fieldset className="reconciliation-candidates" disabled={saving}>
        <legend>Match cleared transactions</legend>
        <p>Checked transactions will be reconciled. Reconciled history and future or scheduled rows stay unchanged.</p>
        {entriesError ? <p className="editor-error" role="alert">{entriesError}</p> : entries === null ? <p>Loading transactions…</p> : candidates.length === 0 ? <p>No eligible transactions through this date.</p> : <div>
          {candidates.map((entry) => <label key={entry.id} className="reconciliation-candidate">
            <input type="checkbox" checked={entry.clearedState === "cleared"} onChange={() => { void toggleCandidate(entry); }} />
            <span><time>{formatDate(entry.date)}</time><strong>{entryLabel(entry)}</strong>{entry.categoryName && <small>{entry.categoryGroupName ? `${entry.categoryGroupName}: ` : ""}{entry.categoryName}</small>}</span>
            <b className={BigInt(entry.amount) < 0n ? "negative" : ""}>{formatHuf(BigInt(entry.amount))}</b>
          </label>)}
        </div>}
      </fieldset>
      {adjustment === 0n ? <p className="reconciliation-match">The cleared balance matches. No adjustment will be created.</p> : <details className="reconciliation-adjustment"><summary>Still does not match?</summary><p className="reconciliation-warning">A reconciled adjustment of {formatHuf(adjustment)} will be added to match the bank balance. Use this only for genuinely missing history.</p><button onClick={finish} disabled={saving}>{saving ? "Reconciling…" : "Create adjustment & reconcile"}</button></details>}
      <div className="editor-actions">{adjustment === 0n && <button onClick={finish} disabled={saving}>{saving ? "Reconciling…" : "Reconcile account"}</button>}<button className="text-button" onClick={() => setReview(null)} disabled={saving}>Edit details</button></div>
    </div>}
  </section>;
}
