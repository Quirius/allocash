import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { assignReadyToAssign, getSavedMutationVersion, hasSavedMutationPending, type PlanSnapshot } from "../lib/desktop";
import { formatHuf, parseSignedHufInput } from "../lib/format";
import { AmountInput } from "./AmountInput";

type Props = { plan: PlanSnapshot; planCurrent: boolean; canWrite: () => boolean; readEpoch: number; mutationPending: boolean; onError: (message: string | null) => void };
type Position = { left: number; top: number; above: boolean };
function place(button: HTMLButtonElement, width: number, height: number): Position {
  const rect = button.getBoundingClientRect();
  const above = rect.bottom + height > window.innerHeight - 8 && rect.top > height;
  const top = above ? rect.top - height - 6 : rect.bottom + 6;
  return { left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - height - 8)), above };
}

export function ReadyToAssign({ plan, planCurrent, canWrite, readEpoch, mutationPending, onError }: Props) {
  const amount = BigInt(plan.readyToAssign);
  const state = amount === 0n ? "zero" : amount > 0n ? "positive" : "negative";
  const [open, setOpen] = useState<"breakdown" | "assign" | null>(null);
  const [position, setPosition] = useState<Position>({ left: 8, top: 8, above: false });
  const [value, setValue] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const anchorButton = useRef<HTMLButtonElement | null>(null);
  const popup = useRef<HTMLElement | null>(null);
  const capture = useRef<{ month: string; epoch: number; version: number; assigned: string } | null>(null);
  const refreshVersion = useRef<number | null>(null);

  function close() {
    if (busyRef.current || waiting) return;
    setOpen(null); setError(null); onError(null); capture.current = null;
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  }
  function show(kind: "breakdown" | "assign", button: HTMLButtonElement) {
    if (!planCurrent || mutationPending || (kind === "assign" && (amount <= 0n || !canWrite()))) return;
    opener.current = button; anchorButton.current = button;
    setPosition(place(button, kind === "assign" ? 350 : 480, kind === "assign" ? 310 : 420));
    setOpen(kind); setError(null); onError(null);
    if (kind === "assign") {
      setValue(amount.toString()); setCategoryId("");
      capture.current = { month: plan.month, epoch: readEpoch, version: getSavedMutationVersion(), assigned: "" };
    }
  }
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!wrapper.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    const reposition = () => { if (anchorButton.current) setPosition(place(anchorButton.current, open === "assign" ? 350 : 480, popup.current?.offsetHeight ?? (open === "assign" ? 310 : 420))); };
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", escape); window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true);
    requestAnimationFrame(() => {
      if (popup.current && anchorButton.current) {
        const rect = anchorButton.current.getBoundingClientRect();
        const height = popup.current.offsetHeight;
        const above = rect.bottom + height > window.innerHeight - 8 && rect.top > height;
        const top = above ? rect.top - height - 6 : rect.bottom + 6;
        const width = popup.current.offsetWidth;
        setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - height - 8)), above });
      }
      if (open === "assign") popup.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    });
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open, busy, waiting]);
  useEffect(() => {
    const version = getSavedMutationVersion();
    if (waiting && !mutationPending && planCurrent && refreshVersion.current !== null && version >= refreshVersion.current && readEpoch > (capture.current?.epoch ?? readEpoch)) {
      setWaiting(false); setOpen(null); setError(null); onError(null); capture.current = null; refreshVersion.current = null;
      requestAnimationFrame(() => opener.current?.focus({ preventScroll: true })); return;
    }
    if (open !== "assign" || busyRef.current || waiting) return;
    const saved = capture.current;
    if (!saved || saved.month !== plan.month || saved.epoch !== readEpoch || saved.version !== version || mutationPending) { setOpen(null); setError(null); capture.current = null; }
  }, [open, plan, planCurrent, readEpoch, mutationPending, busy, waiting, onError]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = capture.current;
    if (!saved || !categoryId || busy || waiting || !planCurrent || !canWrite() || saved.month !== plan.month || saved.epoch !== readEpoch || saved.version !== getSavedMutationVersion() || hasSavedMutationPending()) { setError("Plan is updating. Reopen Assign when the current month is ready."); return; }
    const category = plan.categories.find((item) => item.categoryId === categoryId);
    if (!category || category.assigned !== saved.assigned) { setError("This category changed. Reopen Assign with the current Plan."); return; }
    let parsed: bigint;
    try { parsed = parseSignedHufInput(value); } catch { setError("Enter a positive whole HUF amount."); return; }
    if (parsed <= 0n || amount <= 0n) { setError("Ready to Assign must be positive, and the amount must be greater than zero."); return; }
    busyRef.current = true; setBusy(true); setError(null); onError(null);
    try {
      await assignReadyToAssign({ categoryId, month: saved.month, amount: parsed.toString(), expectedAssigned: saved.assigned });
      refreshVersion.current = getSavedMutationVersion(); busyRef.current = false; setBusy(false); setWaiting(true);
    } catch {
      busyRef.current = false; setBusy(false);
      const message = "Could not assign money. The Plan was not changed; check the amount and try again.";
      setError(message); onError(message);
    }
  }

  const breakdown = plan.readyToAssignBreakdown;
  const currentMonthName = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(new Date(plan.month + "-01T00:00:00Z"));
  const previousMonth = new Date(plan.month + "-01T00:00:00Z");
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
  const previousMonthName = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(previousMonth);
  const portal = open === "breakdown" ? createPortal(<div ref={(node) => { popup.current = node; }} className={"rta-popup rta-breakdown-popup" + (position.above ? " above" : "")} role="dialog" aria-label="Ready to Assign Breakdown" style={{ left: position.left, top: position.top }}>
    <span className="rta-notch" /><h3>Ready to Assign Breakdown</h3>
    {breakdown ? <div className="rta-breakdown-card">
      <BreakdownSummary label="Available to assign" value={BigInt(breakdown.leftoverFromLastMonth) + BigInt(breakdown.incomeThisMonth)} />
      <BreakdownRow label={"Ready to Assign left over from " + previousMonthName} value={breakdown.leftoverFromLastMonth} />
      <BreakdownRow label={"Ready to Assign activity in " + currentMonthName} value={breakdown.incomeThisMonth} />
      <BreakdownSummary label="Assigned and overspending" value={-BigInt(breakdown.assignedThisMonth) - BigInt(breakdown.cashOverspendingFromLastMonth)} />
      <BreakdownRow label={"Assigned in " + currentMonthName} value={breakdown.assignedThisMonth} invert />
      {BigInt(breakdown.cashOverspendingFromLastMonth) !== 0n && <BreakdownRow label={"Cash overspending from " + previousMonthName} value={breakdown.cashOverspendingFromLastMonth} invert />}
      <div className="rta-breakdown-total"><span>Ready to Assign</span><strong>{formatHuf(amount)}</strong></div>
    </div> : <div className="rta-breakdown-card"><p>Breakdown unavailable for this Plan snapshot.</p><div className="rta-breakdown-total"><span>Ready to Assign</span><strong>{formatHuf(amount)}</strong></div></div>}
    <p className="rta-help"><InfoIcon /> This is the money available to assign this month.</p>
  </div>, document.body) : open === "assign" ? createPortal(<div ref={(node) => { popup.current = node; }} className={"rta-popup rta-assign-popup" + (position.above ? " above" : "")} role="dialog" aria-label="Assign Ready to Assign money" style={{ left: position.left, top: position.top }}>
    <span className="rta-notch" /><h3>Assign</h3>
    <form className="rta-assign-scroll" onSubmit={submit}>
      <label>Amount<AmountInput aria-label="Amount to assign" value={value} onChange={(event) => setValue(event.target.value)} disabled={busy || waiting} /></label>
      <label>To<select aria-label="Assign to category" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); const item = plan.categories.find((entry) => entry.categoryId === event.target.value); if (capture.current && item) capture.current.assigned = item.assigned; }} disabled={busy || waiting}>
        <option value="">Choose a category</option>
        {Array.from(new Map(plan.categories.filter((item) => !(item.groupName.trim().toLocaleLowerCase() === "inflow" && item.categoryName.trim().toLocaleLowerCase() === "ready to assign")).map((item) => [item.groupId, item.groupName])).entries()).map(([id, name]) => <optgroup key={id} label={name}>{plan.categories.filter((item) => item.groupId === id && !(item.groupName.trim().toLocaleLowerCase() === "inflow" && item.categoryName.trim().toLocaleLowerCase() === "ready to assign")).map((item) => <option key={item.categoryId} value={item.categoryId}>{item.categoryName}</option>)}</optgroup>)}
      </select></label>
      {error && <p className="rta-error" role="alert">{error}</p>}
      <div className="rta-actions"><button type="button" disabled={busy || waiting} onClick={close}>Cancel</button><button type="submit" disabled={busy || waiting || !categoryId || !planCurrent || mutationPending}>{busy || waiting ? ("Saving" + String.fromCharCode(8230)) : "Assign"}</button></div>
    </form>
  </div>, document.body) : null;

  return <div className="plan-rta-wrap" ref={wrapper}>
    <div className={"plan-rta " + state} aria-busy={!planCurrent || mutationPending || waiting}>
      <button ref={trigger} type="button" className="plan-rta-breakdown" disabled={!planCurrent || mutationPending} aria-label={"Ready to Assign " + formatHuf(amount) + "; open breakdown"} aria-haspopup="dialog" aria-expanded={open === "breakdown"} onClick={(event) => open === "breakdown" ? close() : show("breakdown", event.currentTarget)}>
        <strong>{formatHuf(amount)}</strong>{state === "zero" ? <><span className="rta-status rta-zero-status">All Money Assigned</span><CheckCircle /></> : <span className="rta-status">{state === "positive" ? "Ready to Assign" : "Overassigned"}</span>}
      </button>
      {state === "positive" && <button type="button" className="plan-rta-assign" aria-label="Assign money to a category" disabled={!planCurrent || mutationPending || busy || waiting} onClick={(event) => show("assign", event.currentTarget)}>Assign<Chevron /></button>}
    </div>{portal}
  </div>;
}

function BreakdownRow({ label, value, invert = false }: { label: string; value: string; invert?: boolean }) {
  const parsed = BigInt(value) * (invert ? -1n : 1n);
  const negative = parsed < 0n;
  return <div className="rta-breakdown-row"><MoneyIcon negative={negative} /><span>{label}</span><strong className={negative ? "negative" : ""}>{formatHuf(parsed)}</strong></div>;
}
function BreakdownSummary({ label, value }: { label: string; value: bigint }) {
  const isNegative = value < 0n;
  return <div className="rta-breakdown-summary"><MoneyIcon negative={isNegative} /><strong>{label}</strong><strong className={isNegative ? "negative" : ""}>{formatHuf(value)}</strong></div>;
}
function MoneyIcon({ negative }: { negative: boolean }) { return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d={negative ? "M4.5 8h7" : "M8 4.5v7M4.5 8h7"} /></svg>; }
function Chevron() { return <svg className="rta-chevron" viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5" /></svg>; }
function InfoIcon() { return <svg className="rta-info" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" /><path d="M10 9v5m0-8h.01" /></svg>; }
function CheckCircle() { return <svg className="rta-check" viewBox="0 0 24 24" aria-label="All money assigned"><circle cx="12" cy="12" r="9.5" /><path d="m7.5 12.5 3 3 6-7" /></svg>; }
