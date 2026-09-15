import { useState } from "react";
import {
  RECONCILIATION_OUT_OF_DATE, previewAccountReconciliation, reconcileAccount,
  type AccountOverview, type ReconciliationReview,
} from "../lib/desktop";
import { formatHuf, localCalendarDate, parseSignedHufInput } from "../lib/format";

export function ReconciliationEditor({ account, onSaved, onCancel }: {
  account: AccountOverview; onSaved: () => Promise<void>; onCancel: () => void;
}) {
  const [asOf, setAsOf] = useState(localCalendarDate());
  const [bankBalance, setBankBalance] = useState("");
  const [review, setReview] = useState<ReconciliationReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const invalidate = () => { setReview(null); setError(null); };
  async function reviewAccount() {
    try {
      setSaving(true); setError(null);
      const amount = parseSignedHufInput(bankBalance);
      setReview(await previewAccountReconciliation({ accountId: account.id, asOf, bankClearedBalance: amount.toString(), expectedClearedBalance: null }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review this account."); }
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
  return <section className="transaction-editor reconciliation-editor" aria-labelledby="reconcile-title">
    <div className="editor-heading"><div><p className="eyebrow">RECONCILIATION</p><h2 id="reconcile-title">Reconcile {account.name}</h2></div><button className="text-button" onClick={onCancel} disabled={saving}>Cancel</button></div>
    <p className="editor-help">Enter the cleared balance shown by your bank. Pending items stay uncleared.</p>
    <div className="editor-grid"><label>Through date<input type="date" value={asOf} onChange={(event) => { setAsOf(event.target.value); invalidate(); }} disabled={saving} /></label><label>Bank cleared balance<input value={bankBalance} onChange={(event) => { setBankBalance(event.target.value); invalidate(); }} placeholder="e.g. -12 500" inputMode="text" disabled={saving} /></label></div>
    {error && <p className="editor-error" role="alert">{error}</p>}
    {!review ? <button onClick={reviewAccount} disabled={saving}>{saving ? "Reviewing…" : "Review reconciliation"}</button> : <div className="reconciliation-review">
      <dl><div><dt>Allocash cleared</dt><dd>{formatHuf(BigInt(review.appClearedBalance))}</dd></div><div><dt>Bank cleared</dt><dd>{formatHuf(BigInt(review.bankClearedBalance))}</dd></div><div><dt>Entries to reconcile</dt><dd>{review.clearedEntryCount}</dd></div></dl>
      {adjustment === 0n ? <p>No adjustment will be created.</p> : <p className="reconciliation-warning">A reconciled adjustment of {formatHuf(adjustment)} will be added to match the bank balance.</p>}
      <div className="editor-actions"><button onClick={finish} disabled={saving}>{saving ? "Reconciling…" : adjustment === 0n ? "Reconcile account" : "Create adjustment & reconcile"}</button><button className="text-button" onClick={() => setReview(null)} disabled={saving}>Edit details</button></div>
    </div>}
  </section>;
}
