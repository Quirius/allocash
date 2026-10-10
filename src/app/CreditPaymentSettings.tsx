import { useEffect, useRef, useState } from "react";
import { getSavedMutationVersion, hasSavedMutationPending, loadPlanMonth, setCreditPaymentCategory, type PlanSnapshot } from "../lib/desktop";
import { localCalendarMonth } from "../lib/format";
import { createRequestSequence } from "../lib/request-sequence";

export function CreditPaymentSettings({ refreshRevision = 0, readEpoch = 0, mutationPending = false, restoreBusy = false }: { refreshRevision?: number; readEpoch?: number; mutationPending?: boolean; restoreBusy?: boolean }) {
  const [month] = useState(localCalendarMonth);
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [planEpoch, setPlanEpoch] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const sequence = useRef(createRequestSequence());
  const currentEpoch = useRef(readEpoch);
  currentEpoch.current = readEpoch;
  const current = !!plan && plan.month === month && planEpoch === readEpoch && !mutationPending && !restoreBusy && !loading && !error;

  async function reload(requestedEpoch = currentEpoch.current) {
    if (requestedEpoch !== currentEpoch.current || mutationPending || restoreBusy) return;
    const request = sequence.current.begin();
    setLoading(true);
    try {
      const value = await loadPlanMonth(month);
      if (!sequence.current.isCurrent(request) || requestedEpoch !== currentEpoch.current || hasSavedMutationPending() || getSavedMutationVersion() !== requestedEpoch) return;
      setPlan(value);
      setPlanEpoch(requestedEpoch);
      setError(value ? null : "Credit payment settings are available in the desktop app.");
    } catch {
      if (sequence.current.isCurrent(request) && requestedEpoch === currentEpoch.current) setError("Could not load credit payment settings.");
    } finally {
      if (sequence.current.isCurrent(request) && requestedEpoch === currentEpoch.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (mutationPending || restoreBusy) {
      sequence.current.invalidate();
      setLoading(true);
      return;
    }
    setError(null);
    void reload(readEpoch);
    return () => sequence.current.invalidate();
  }, [month, refreshRevision, readEpoch, mutationPending, restoreBusy]);

  async function mapPayment(accountId: string, categoryId: string) {
    if (!current || mutationPending || restoreBusy || hasSavedMutationPending() || getSavedMutationVersion() !== readEpoch) return;
    try {
      await setCreditPaymentCategory(accountId, categoryId || null);
      setSaveError(null);
    } catch {
      setSaveError("Could not save this credit-card payment category.");
    }
  }

  return <section className="plan-credit" aria-label="Advanced credit payment settings">
    {loading && <p role="status">Loading credit payment settings…</p>}
    {error && <p className="editor-error" role="alert">{error} <button type="button" onClick={() => void reload(readEpoch)} disabled={mutationPending || restoreBusy}>Retry</button></p>}
    {saveError && <p className="editor-error" role="alert">{saveError}</p>}
    {current && plan && <>
      <strong>Credit card payment categories</strong>
      <p>New credit cards automatically get their own payment category. You can adjust an existing link here.</p>
      {plan.creditPaymentCategories.map((mapping) => {
        const mappedCategory = plan.categories.find((category) => category.categoryId === mapping.categoryId);
        return <label key={mapping.accountId}>{mapping.accountName}<select value={mapping.categoryId ?? ""} disabled={!current} onChange={(event) => void mapPayment(mapping.accountId, event.target.value)}>
          <option value="">Not mapped</option>
          {mapping.categoryId && !mappedCategory && <option value={mapping.categoryId} disabled>Previously mapped category (unavailable)</option>}
          {plan.categories.map((category) => <option key={category.categoryId} value={category.categoryId} disabled={plan.creditPaymentCategories.some((other) => other.accountId !== mapping.accountId && other.categoryId === category.categoryId)}>{category.groupName} / {category.categoryName}</option>)}
        </select></label>;
      })}
      {plan.creditPaymentCategories.length === 0 && <p>No credit accounts need a payment category.</p>}
    </>}
  </section>;
}
