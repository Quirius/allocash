import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSavedMutationVersion, hasSavedMutationPending, loadPlanMonth, movePlanMoney, setCategoryTarget, setCategoryTargetSnoozed, setCreditPaymentCategory, setPlanAssignment, type PlanSnapshot, type RecurrenceMonths } from "../lib/desktop";
import { formatHuf, localCalendarMonth, parseSignedHufInput, shiftCalendarMonth } from "../lib/format";
import { recurrenceLabel } from "../lib/recurrence";
import { createRequestSequence } from "../lib/request-sequence";
import { canSubmitPlanMove, createPlanMovePayload, defaultPlanMoveAmount, isPlanMoveRequestCurrent, ownedPlanMoveVersion, planMoveDestinations, READY_TO_ASSIGN_DESTINATION, shouldDismissPlanMove } from "./plan-move";

export function PlanView({ refreshRevision = 0, readEpoch = 0, mutationPending = false }: { refreshRevision?: number; readEpoch?: number; mutationPending?: boolean }) {
  const [month, setMonth] = useState(localCalendarMonth());
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const planRequest = useRef(createRequestSequence());
  const currentMonth = useRef(month);
  const currentReadEpoch = useRef(readEpoch);
  currentMonth.current = month;
  currentReadEpoch.current = readEpoch;
  const error = actionError ?? loadError;
  const [moveSource, setMoveSource] = useState<{ id: string; name: string; available: string; categories: PlanSnapshot["categories"]; readyToAssign: string } | null>(null);
  const [toCategory, setToCategory] = useState(""); const [moveAmount, setMoveAmount] = useState(""); const [moveBusy, setMoveBusy] = useState(false); const moveBusyRef = useRef(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const moveGeneration = useRef(0);
  const ownedMoveVersion = useRef<number | null>(null);
  const focusedMoveGeneration = useRef(-1);
  const popupRef = useRef<HTMLFormElement>(null); const amountRef = useRef<HTMLInputElement>(null); const sourceButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusCategory = useRef<string | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ left: number; top: number; above: boolean }>({ left: 0, top: 0, above: false });
  const [targetCategory, setTargetCategory] = useState(""); const [targetBehavior, setTargetBehavior] = useState<"set_aside" | "refill">("refill"); const [targetAmount, setTargetAmount] = useState(""); const [dueKind, setDueKind] = useState<"day" | "last_day">("last_day"); const [dueDay, setDueDay] = useState("1");
  const [targetInterval, setTargetInterval] = useState<RecurrenceMonths>(1);
  const [firstDueMonth, setFirstDueMonth] = useState(month);
  function selectTargetCategory(categoryId: string) {
    setTargetCategory(categoryId);
    const target = plan?.categories.find((category) => category.categoryId === categoryId)?.target;
    setTargetBehavior(target?.behavior ?? "refill");
    setTargetAmount(target?.amount ?? "");
    setTargetInterval(target?.intervalMonths ?? 1);
    setDueKind(target?.dueKind ?? "last_day");
    setDueDay(String(target?.dueDay ?? 1));
    setFirstDueMonth(target?.dueMonth ?? target?.firstDueMonth ?? month);
  }
  function selectTargetInterval(interval: RecurrenceMonths) {
    setTargetInterval(interval);
    setFirstDueMonth(shiftCalendarMonth(month, interval - 1));
  }
  function restoreMoveFocus() {
    const categoryId = restoreFocusCategory.current;
    if (categoryId) {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".plan-available")).find((item) => item.dataset.categoryId === categoryId);
      if (button) { button.focus(); restoreFocusCategory.current = null; return; }
    }
    document.getElementById("plan-title")?.focus();
  }
  function closeMove(restoreFocus = true, force = false) {
    if (moveBusyRef.current && !force) return;
    moveGeneration.current += 1;
    if (restoreFocus && moveSource) restoreFocusCategory.current = moveSource.id;
    setMoveSource(null); setMoveAmount(""); setToCategory(""); setMoveError(null);
    if (!moveBusyRef.current) setMoveBusy(false);
    if (restoreFocus) requestAnimationFrame(restoreMoveFocus);
  }
  useEffect(() => { setTargetCategory(""); setTargetAmount(""); setActionError(null); }, [month]);
  useEffect(() => { closeMove(false, true); }, [month]);
  useEffect(() => { if (shouldDismissPlanMove(moveBusyRef.current, ownedMoveVersion.current, getSavedMutationVersion())) closeMove(false, true); }, [readEpoch, refreshRevision]);
  useEffect(() => { if (restoreFocusCategory.current) requestAnimationFrame(restoreMoveFocus); }, [plan]);
  async function reload(requestedMonth = month, requestedEpoch = currentReadEpoch.current) {
    if (requestedMonth !== currentMonth.current || requestedEpoch !== currentReadEpoch.current) return;
    const request = planRequest.current.begin();
    try {
      const value = await loadPlanMonth(requestedMonth);
      if (!planRequest.current.isCurrent(request) || requestedMonth !== currentMonth.current || requestedEpoch !== currentReadEpoch.current) return;
      setPlan(value);
      setLoadError(value ? null : "The Plan is available in the desktop app.");
    } catch {
      if (planRequest.current.isCurrent(request) && requestedMonth === currentMonth.current && requestedEpoch === currentReadEpoch.current) setLoadError("Could not load this Plan month.");
    }
  }
  useEffect(() => {
    if (mutationPending) {
      planRequest.current.invalidate();
      return;
    }
    setPlan(null); setLoadError(null);
    void reload(month, readEpoch);
    return () => planRequest.current.invalidate();
  }, [month, refreshRevision, readEpoch, mutationPending]);
  async function save(categoryId: string, value: string) { try { await setPlanAssignment(categoryId, month, parseSignedHufInput(value).toString()); setActionError(null); } catch { setActionError("Enter a whole HUF assignment amount."); } }
  async function move(event: FormEvent) {
    event.preventDefault();
    if (!moveSource || !toCategory || moveBusyRef.current || mutationPending || hasSavedMutationPending()) return;
    const requestedMonth = month;
    const requestedGeneration = moveGeneration.current;
    const startingVersion = getSavedMutationVersion();
    let payload: ReturnType<typeof createPlanMovePayload>;
    try { payload = createPlanMovePayload(moveSource.id, toCategory, parseSignedHufInput(moveAmount).toString()); }
    catch { setMoveError("Choose a destination and a positive whole HUF amount."); return; }
    moveBusyRef.current = true; setMoveBusy(true);
    try {
      await movePlanMoney(payload.fromCategoryId, payload.toCategoryId, requestedMonth, payload.amount);
      ownedMoveVersion.current = ownedPlanMoveVersion(startingVersion, getSavedMutationVersion());
      moveBusyRef.current = false; setMoveBusy(false);
      if (isPlanMoveRequestCurrent(requestedMonth, currentMonth.current, requestedGeneration, moveGeneration.current)) { setActionError(null); closeMove(ownedMoveVersion.current !== null); }
    }
    catch {
      ownedMoveVersion.current = ownedPlanMoveVersion(startingVersion, getSavedMutationVersion());
      moveBusyRef.current = false; setMoveBusy(false);
      if (isPlanMoveRequestCurrent(requestedMonth, currentMonth.current, requestedGeneration, moveGeneration.current)) { if (ownedMoveVersion.current === null) { closeMove(false, true); return; } const message = "Could not move money. Check the amount and try again."; setMoveError(message); setActionError(message); }
    }
  }
  function openMove(category: PlanSnapshot["categories"][number], button: HTMLButtonElement) {
    if (moveBusyRef.current || mutationPending || hasSavedMutationPending() || !plan) return;
    moveGeneration.current += 1;
    sourceButtonRef.current = button;
    const rect = button.getBoundingClientRect(); const width = Math.min(360, window.innerWidth - 24); const height = 184;
    const above = rect.bottom + height > window.innerHeight - 12 && rect.top > height;
    setPopupPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: above ? rect.top : Math.min(rect.bottom + 6, window.innerHeight - height - 12), above });
    setActionError(null); setMoveError(null); setMoveSource({ id: category.categoryId, name: category.categoryName, available: category.available, categories: plan.categories, readyToAssign: plan.readyToAssign });
    setMoveAmount(defaultPlanMoveAmount(category.available)); setToCategory("");
  }
  useEffect(() => {
    if (!moveSource) return;
    const update = () => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".plan-available")).find((item) => item.dataset.categoryId === moveSource.id) ?? sourceButtonRef.current;
      if (!button?.isConnected) return;
      sourceButtonRef.current = button;
      const rect = button.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      const height = popupRef.current?.getBoundingClientRect().height ?? 200;
      const above = rect.bottom + 6 + height > window.innerHeight - 12 && rect.top - 6 - height >= 12;
      setPopupPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: above ? rect.top - 6 : Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12)), above });
    };
    const onPointerDown = (event: PointerEvent) => { if (!popupRef.current?.contains(event.target as Node) && !sourceButtonRef.current?.contains(event.target as Node)) closeMove(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closeMove(); } };
    update();
    document.addEventListener("pointerdown", onPointerDown); document.addEventListener("keydown", onKeyDown); window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    if (focusedMoveGeneration.current !== moveGeneration.current) { focusedMoveGeneration.current = moveGeneration.current; amountRef.current?.focus(); amountRef.current?.select(); }
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [moveSource, moveError, plan]);
  useEffect(() => { if (mutationPending && !moveBusy) closeMove(false); }, [mutationPending, moveBusy]);
  async function mapPayment(accountId: string, categoryId: string) { try { await setCreditPaymentCategory(accountId, categoryId || null); setActionError(null); } catch { setActionError("Could not save this credit-card payment category."); } }
  async function saveTarget(event: FormEvent) { event.preventDefault(); try { if (!targetCategory) throw new Error(); const amount = parseSignedHufInput(targetAmount); const day = Number(dueDay); if (amount <= 0n || (dueKind === "day" && (!Number.isInteger(day) || day < 1 || day > 31))) throw new Error(); if (targetInterval !== 1 && (!firstDueMonth || firstDueMonth < month)) throw new Error(); await setCategoryTarget(targetCategory, month, { behavior: targetBehavior, amount: amount.toString(), dueKind, dueDay: dueKind === "day" ? day : null, intervalMonths: targetInterval, firstDueMonth: targetInterval === 1 ? null : firstDueMonth }); setActionError(null); } catch { setActionError("Choose a category, a positive whole HUF amount, and a valid due date in this or a later month."); } }
  async function clearTarget() { try { if (!targetCategory) throw new Error(); await setCategoryTarget(targetCategory, month, null); setActionError(null); } catch { setActionError("Choose a category to clear its target."); } }
  async function toggleTargetSnooze(categoryId: string, snoozed: boolean) { try { await setCategoryTargetSnoozed(categoryId, month, snoozed); setActionError(null); } catch { setActionError("Could not update this month’s target snooze."); } }
  return <section className="plan-view" aria-labelledby="plan-title">
    <div className="plan-toolbar"><div><p className="eyebrow">MONTHLY PLAN</p><h2 id="plan-title" tabIndex={-1}>{month}</h2></div><div><button onClick={() => setMonth(shiftCalendarMonth(month, -1))}>←</button><button onClick={() => setMonth(localCalendarMonth())}>Today</button><button onClick={() => setMonth(shiftCalendarMonth(month, 1))}>→</button></div></div>
    {error && <p className="editor-error" role="alert">{error}</p>}
    {!plan ? <div className="register-message" role="status">Loading Plan…</div> : <>
      <div className="plan-rta"><span>Ready to Assign</span><strong>{formatHuf(BigInt(plan.readyToAssign))}</strong></div>
      <form className="plan-target" inert={moveBusy} onSubmit={saveTarget}>
        <strong>Category target</strong>
        <select aria-label="Target category" value={targetCategory} onChange={(event) => selectTargetCategory(event.target.value)}><option value="">Category</option>{plan.categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.groupName} / {category.categoryName}</option>)}</select>
        <select aria-label="Target behavior" value={targetBehavior} onChange={(event) => setTargetBehavior(event.target.value as "set_aside" | "refill")}><option value="refill">Refill up to</option><option value="set_aside">Set aside another</option></select>
        <select aria-label="Target repeat frequency" value={targetInterval} onChange={(event) => selectTargetInterval(Number(event.target.value) as RecurrenceMonths)}><option value={1}>Monthly</option><option value={3}>Quarterly</option><option value={12}>Yearly</option></select>
        <label>Amount per period<input aria-label="Target amount" value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} placeholder="HUF" inputMode="numeric" /></label>
        {targetInterval !== 1 && <label>First due month<input aria-label="Target first due month" type="month" min={month} value={firstDueMonth} onChange={(event) => setFirstDueMonth(event.target.value)} required /></label>}
        <label>Due date<select aria-label="Target due date" value={dueKind} onChange={(event) => setDueKind(event.target.value as "day" | "last_day")}><option value="last_day">Last day of month</option><option value="day">Day of month</option></select></label>
        {dueKind === "day" && <input aria-label="Target due day" value={dueDay} onChange={(event) => setDueDay(event.target.value)} inputMode="numeric" />}
        <button disabled={!targetCategory || !targetAmount}>Save target</button><button type="button" disabled={!targetCategory} onClick={() => void clearTarget()}>Clear</button>
        {targetInterval !== 1 && <p className="target-help">The total is spread across the months through the due month, then repeats every {targetInterval} months. The due date comes from these settings.</p>}
      </form>
      {plan.creditPaymentCategories.length > 0 && <div className="plan-credit" inert={moveBusy}><strong>Credit card payment categories</strong><p>Funded card spending adds the funded portion to its mapped payment category.</p>{plan.creditPaymentCategories.map((mapping) => <label key={mapping.accountId}>{mapping.accountName}<select value={mapping.categoryId ?? ""} onChange={(event) => void mapPayment(mapping.accountId, event.target.value)}><option value="">Not mapped</option>{plan.categories.map((category) => <option key={category.categoryId} value={category.categoryId} disabled={plan.creditPaymentCategories.some((other) => other.accountId !== mapping.accountId && other.categoryId === category.categoryId)}>{category.groupName} / {category.categoryName}</option>)}</select></label>)}</div>}
      <div className="plan-table" inert={moveBusy}><div className="plan-head"><span>Category</span><span>Assigned</span><span>Activity</span><span>Available</span></div>{plan.categories.map((category) => <div className="plan-row" key={category.categoryId}><span><small>{category.groupName}</small>{category.categoryName}{category.target && <em>{category.target.snoozed ? "Snoozed this month" : `${formatHuf(BigInt(category.target.toGo))} more needed this month ? ${recurrenceLabel(category.target.intervalMonths)}${category.target.dueMonth ? ` ? Due ${category.target.dueMonth}, ${category.target.dueKind === "last_day" ? "last day" : `day ${category.target.dueDay}`}` : ""}`} <button type="button" onClick={() => void toggleTargetSnooze(category.categoryId, !(category.target?.snoozed ?? false))}>{category.target.snoozed ? "Resume" : "Snooze"}</button></em>}</span><input key={`${month}-${category.categoryId}-${category.assigned}`} className={BigInt(category.assigned) < 0n ? "plan-negative" : undefined} aria-label={`${category.categoryName} assigned`} defaultValue={category.assigned} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { if (event.target.value !== category.assigned) void save(category.categoryId, event.target.value); }} /><span>{formatHuf(BigInt(category.activity))}</span><button type="button" data-category-id={category.categoryId} className={`plan-available ${BigInt(category.available) > 0n ? "positive" : BigInt(category.available) < 0n ? "negative" : "zero"}`} aria-label={`${category.categoryName} available ${formatHuf(BigInt(category.available))}; move money`} disabled={mutationPending || moveBusy} onClick={(event) => openMove(category, event.currentTarget)}>{formatHuf(BigInt(category.available))}</button></div>)}</div>
    </>}
      {moveSource && <form ref={popupRef} className="plan-move-popup" style={{ left: popupPosition.left, top: popupPosition.top, transform: popupPosition.above ? "translateY(-100%)" : undefined }} onSubmit={move} aria-label={`Move money out of ${moveSource.name}`}>
        <strong>Move from {moveSource.name}</strong>
        <label>Amount<input ref={amountRef} aria-label="Move amount" disabled={moveBusy} value={moveAmount} onChange={(event) => setMoveAmount(event.target.value)} placeholder="HUF" inputMode="numeric" /></label>
        <label>To<select aria-label="Move money to" disabled={moveBusy} value={toCategory} onChange={(event) => setToCategory(event.target.value)}><option value="">Choose destination</option><option value={READY_TO_ASSIGN_DESTINATION}>Ready to Assign — {formatHuf(BigInt(moveSource.readyToAssign))}</option>{Array.from(new Set(moveSource.categories.map((category) => category.groupName))).map((group) => <optgroup key={group} label={group}>{planMoveDestinations(moveSource.categories.filter((category) => category.groupName === group), moveSource.id).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName} — {formatHuf(BigInt(category.available))}</option>)}</optgroup>)}</select></label>
        {moveError && <p className="editor-error" role="alert">{moveError}</p>}
        <div><button type="button" disabled={moveBusy} onClick={() => closeMove()}>Cancel</button><button type="submit" disabled={!canSubmitPlanMove(moveSource.id, toCategory, moveAmount) || moveBusy || mutationPending}>{moveBusy ? "Saving…" : "Move"}</button></div>
      </form>}
  </section>;
}
