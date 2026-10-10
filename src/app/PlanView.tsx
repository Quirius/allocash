import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSavedMutationVersion, hasSavedMutationPending, loadPlanMonth, movePlanMoney, setCategoryNotes, setCategoryTarget, setCategoryTargetSnoozed, setCreditPaymentCategory, setPlanAssignment, type CreditPaymentCategory, type PlanCategory, type PlanSnapshot, type RecurrenceMonths } from "../lib/desktop";
import { formatHuf, localCalendarMonth, parseSignedHufInput, shiftCalendarMonth } from "../lib/format";
import { CreditPaymentDetails } from "./CreditPaymentDetails";
import { creditPaymentStatus } from "./credit-payment";
import { recurrenceLabel } from "../lib/recurrence";
import { createRequestSequence } from "../lib/request-sequence";
import { editCategoryNote, finishCategoryNoteSave, markCategoryNoteSaving, reconcileCategoryNoteDrafts, type CategoryNoteDrafts } from "./category-notes";
import { canSubmitPlanMove, createPlanMovePayload, defaultPlanMoveAmount, isPlanMoveRequestCurrent, ownedPlanMoveVersion, planMoveDestinations, READY_TO_ASSIGN_DESTINATION, shouldDismissPlanMove } from "./plan-move";

export function PlanView({ refreshRevision = 0, readEpoch = 0, mutationPending = false }: { refreshRevision?: number; readEpoch?: number; mutationPending?: boolean }) {
  const [month, setMonth] = useState(localCalendarMonth());
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [planEpoch, setPlanEpoch] = useState(-1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const planRequest = useRef(createRequestSequence());
  const currentMonth = useRef(month);
  const currentSelectedCategory = useRef<string | null>(null);
  const currentReadEpoch = useRef(readEpoch);
  currentMonth.current = month;
  currentReadEpoch.current = readEpoch;
  const error = actionError ?? loadError;
  const planCurrent = !!plan && plan.month === month && planEpoch === readEpoch && !mutationPending;
  function canWritePlan() { return planCurrent && plan?.month === currentMonth.current && planEpoch === getSavedMutationVersion() && !hasSavedMutationPending(); }
  const [moveSource, setMoveSource] = useState<{ id: string; name: string; available: string; categories: PlanSnapshot["categories"]; readyToAssign: string } | null>(null);
  const [toCategory, setToCategory] = useState(""); const [moveAmount, setMoveAmount] = useState(""); const [moveBusy, setMoveBusy] = useState(false); const moveBusyRef = useRef(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const moveGeneration = useRef(0);
  const ownedMoveVersion = useRef<number | null>(null);
  const focusedMoveGeneration = useRef(-1);
  const popupRef = useRef<HTMLFormElement>(null); const amountRef = useRef<HTMLInputElement>(null); const sourceButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusCategory = useRef<string | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ left: number; top: number; above: boolean }>({ left: 0, top: 0, above: false });
  const [targetBehavior, setTargetBehavior] = useState<"set_aside" | "refill">("refill"); const [targetAmount, setTargetAmount] = useState(""); const [dueKind, setDueKind] = useState<"day" | "last_day">("last_day"); const [dueDay, setDueDay] = useState("1");
  const [targetInterval, setTargetInterval] = useState<RecurrenceMonths>(1);
  const [firstDueMonth, setFirstDueMonth] = useState(month);
  const [targetHydrationRevision, setTargetHydrationRevision] = useState(0);
  const targetDirty = useRef(false);
  const previousReadEpoch = useRef(readEpoch);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  currentSelectedCategory.current = selectedCategoryId;
  const [noteDrafts, setNoteDrafts] = useState<CategoryNoteDrafts>({});
  const noteDraftsRef = useRef<CategoryNoteDrafts>({});
  const latestPlan = useRef<PlanSnapshot | null>(null);
  const hydratedTarget = useRef("");
  const expectedTarget = useRef<{ key: string; fingerprint: string; version: number } | null>(null);
  function selectCategory(categoryId: string) {
    if (selectedCategoryId === categoryId) return;
    setSelectedCategoryId(categoryId);
    targetDirty.current = false;
    expectedTarget.current = null;
    const target = plan?.categories.find((item) => item.categoryId === categoryId)?.target;
    setTargetBehavior(target?.behavior ?? "refill"); setTargetAmount(target?.amount ?? "");
    setTargetInterval(target?.intervalMonths ?? 1); setDueKind(target?.dueKind ?? "last_day");
    setDueDay(String(target?.dueDay ?? 1)); setFirstDueMonth(target?.dueMonth ?? target?.firstDueMonth ?? month);
    const selected = plan?.categories.find((item) => item.categoryId === categoryId);
    hydratedTarget.current = `${month}:${categoryId}:${targetFingerprint(selected?.target ?? null)}`;
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
  useEffect(() => { setActionError(null); targetDirty.current = false; expectedTarget.current = null; hydratedTarget.current = ""; setTargetHydrationRevision((value) => value + 1); }, [month]);
  useEffect(() => { closeMove(false, true); }, [month]);
  useEffect(() => { if (shouldDismissPlanMove(moveBusyRef.current, ownedMoveVersion.current, getSavedMutationVersion())) closeMove(false, true); }, [readEpoch, refreshRevision]);
  useEffect(() => { if (restoreFocusCategory.current) requestAnimationFrame(restoreMoveFocus); }, [plan]);
  async function reload(requestedMonth = month, requestedEpoch = currentReadEpoch.current) {
    if (requestedMonth !== currentMonth.current || requestedEpoch !== currentReadEpoch.current) return;
    const request = planRequest.current.begin();
    try {
      const value = await loadPlanMonth(requestedMonth);
      if (!planRequest.current.isCurrent(request) || requestedMonth !== currentMonth.current || requestedEpoch !== currentReadEpoch.current || hasSavedMutationPending() || getSavedMutationVersion() !== requestedEpoch) return;
      latestPlan.current = value;
      if (value) {
        const notes = Object.fromEntries(value.categories.map((category) => [category.categoryId, category.notes]));
        const nextDrafts = reconcileCategoryNoteDrafts(noteDraftsRef.current, notes);
        noteDraftsRef.current = nextDrafts; setNoteDrafts(nextDrafts);
        if (expectedTarget.current && expectedTarget.current.version <= requestedEpoch) expectedTarget.current = null;
      }
      setPlan(value);
      setPlanEpoch(requestedEpoch);
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
    setLoadError(null);
    void reload(month, readEpoch);
    return () => planRequest.current.invalidate();
  }, [month, refreshRevision, readEpoch, mutationPending]);
  useEffect(() => {
    if (readEpoch !== previousReadEpoch.current && !mutationPending && !targetDirty.current) {
      hydratedTarget.current = "";
      setTargetHydrationRevision((value) => value + 1);
    }
    if (!mutationPending) previousReadEpoch.current = readEpoch;
  }, [readEpoch, mutationPending]);
  useEffect(() => {
    if (!plan || plan.month !== month || !plan.categories.length) return;
    const exists = plan.categories.some((item) => item.categoryId === selectedCategoryId);
    const nextId = exists ? selectedCategoryId! : plan.categories[0]!.categoryId;
    if (!exists) setSelectedCategoryId(nextId);
    const target = plan.categories.find((item) => item.categoryId === nextId)!.target;
    const fingerprint = targetFingerprint(target);
    const key = `${month}:${nextId}:${fingerprint}`;
    if (hydratedTarget.current === key) return;
    if (expectedTarget.current?.key === `${month}:${nextId}` && expectedTarget.current.fingerprint !== fingerprint) return;
    if (expectedTarget.current?.key === `${month}:${nextId}`) expectedTarget.current = null;
    setTargetBehavior(target?.behavior ?? "refill"); setTargetAmount(target?.amount ?? "");
    setTargetInterval(target?.intervalMonths ?? 1); setDueKind(target?.dueKind ?? "last_day");
    setDueDay(String(target?.dueDay ?? 1)); setFirstDueMonth(target?.dueMonth ?? target?.firstDueMonth ?? month);
    hydratedTarget.current = key;
  }, [plan, month, selectedCategoryId, targetHydrationRevision]);
  async function save(categoryId: string, value: string): Promise<boolean> { if (!canWritePlan()) { setActionError("Plan is updating. Your assignment is still here; blur the field again to retry."); return false; } try { await setPlanAssignment(categoryId, month, parseSignedHufInput(value).toString()); setActionError(null); return true; } catch { setActionError("Enter a whole HUF assignment amount."); return false; } }
  async function move(event: FormEvent) {
    event.preventDefault();
    if (!moveSource || !toCategory || moveBusyRef.current || !canWritePlan()) return;
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
    if (!canWritePlan() || moveBusyRef.current || !plan) return;
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
  async function mapPayment(accountId: string, categoryId: string) { if (!canWritePlan()) return; try { await setCreditPaymentCategory(accountId, categoryId || null); setActionError(null); } catch { setActionError("Could not save this credit-card payment category."); } }
  async function saveTarget(event: FormEvent) {
    event.preventDefault(); if (!canWritePlan()) return; const categoryId = selectedCategoryId; const targetMonth = month;
    try {
      if (!categoryId) throw new Error();
      const amount = parseSignedHufInput(targetAmount); const day = Number(dueDay);
      if (amount <= 0n || (dueKind === "day" && (!Number.isInteger(day) || day < 1 || day > 31))) throw new Error();
      if (targetInterval !== 1 && (!firstDueMonth || firstDueMonth < targetMonth)) throw new Error();
      const definition = { behavior: targetBehavior, amount: amount.toString(), dueKind, dueDay: dueKind === "day" ? day : null, intervalMonths: targetInterval, firstDueMonth: targetInterval === 1 ? null : firstDueMonth };
      await setCategoryTarget(categoryId, targetMonth, definition);
      expectedTarget.current = { key: `${targetMonth}:${categoryId}`, fingerprint: targetFingerprint(definition), version: getSavedMutationVersion() };
      if (currentSelectedCategory.current === categoryId && currentMonth.current === targetMonth) {
        targetDirty.current = false; hydratedTarget.current = ""; setTargetHydrationRevision((value) => value + 1); setActionError(null);
      }
    } catch {
      if (currentSelectedCategory.current === categoryId && currentMonth.current === targetMonth) setActionError("Choose a category, a positive whole HUF amount, and a valid due date in this or a later month.");
    }
  }
  async function clearTarget() {
    if (!canWritePlan()) return;
    const categoryId = selectedCategoryId; const targetMonth = month;
    try {
      if (!categoryId) throw new Error();
      await setCategoryTarget(categoryId, targetMonth, null);
      expectedTarget.current = { key: `${targetMonth}:${categoryId}`, fingerprint: "none", version: getSavedMutationVersion() };
      if (currentSelectedCategory.current === categoryId && currentMonth.current === targetMonth) {
        targetDirty.current = false; hydratedTarget.current = ""; setTargetHydrationRevision((value) => value + 1); setActionError(null);
      }
    } catch { if (currentSelectedCategory.current === categoryId && currentMonth.current === targetMonth) setActionError("Choose a category to clear its target."); }
  }
  async function toggleTargetSnooze(categoryId: string, snoozed: boolean) { if (!canWritePlan()) return; try { await setCategoryTargetSnoozed(categoryId, month, snoozed); setActionError(null); } catch { setActionError("Could not update this month’s target snooze."); } }
  async function saveNotes(categoryId: string, notes: string) {
    if (noteDraftsRef.current[categoryId]?.status === "saving") return;
    const saving = markCategoryNoteSaving(noteDraftsRef.current, categoryId, notes);
    noteDraftsRef.current = saving; setNoteDrafts(saving);
    try {
      await setCategoryNotes(categoryId, notes);
      const current = noteDraftsRef.current[categoryId];
      const saved = current?.value === notes ? { ...noteDraftsRef.current } : finishCategoryNoteSave(noteDraftsRef.current, categoryId, notes, true);
      if (current?.value === notes) {
        delete saved[categoryId];
        if (latestPlan.current) latestPlan.current = { ...latestPlan.current, categories: latestPlan.current.categories.map((item) => item.categoryId === categoryId ? { ...item, notes } : item) };
        setPlan((currentPlan) => currentPlan ? { ...currentPlan, categories: currentPlan.categories.map((item) => item.categoryId === categoryId ? { ...item, notes } : item) } : currentPlan);
      }
      noteDraftsRef.current = saved; setNoteDrafts(saved);
    } catch {
      const failed = finishCategoryNoteSave(noteDraftsRef.current, categoryId, notes, false);
      noteDraftsRef.current = failed; setNoteDrafts(failed);
    }
  }
  const selectedCategory = plan?.categories.find((category) => category.categoryId === selectedCategoryId) ?? null;
  const selectedNote = selectedCategory ? noteDrafts[selectedCategory.categoryId] : undefined;
  function editNotes(categoryId: string, value: string) { const next = editCategoryNote(noteDraftsRef.current, categoryId, value); noteDraftsRef.current = next; setNoteDrafts(next); }
  const detailsPanel = <CategoryDetailsPanel key={`${selectedCategory?.categoryId ?? "none"}:${month}`} category={selectedCategory} creditPayment={plan?.creditPaymentCategories.find((mapping) => mapping.categoryId === selectedCategory?.categoryId) ?? null} month={plan?.month ?? month} notes={selectedCategory ? (selectedNote?.value ?? selectedCategory.notes ?? "") : ""} noteStatus={selectedNote?.status ?? ""} noteBusy={mutationPending} onNotesChange={editNotes} onSaveNotes={saveNotes} targetBusy={!planCurrent || moveBusy} target={{ behavior: targetBehavior, amount: targetAmount, interval: targetInterval, dueKind, dueDay, firstDueMonth }} onTargetChange={(field, value) => { targetDirty.current = true; if (field === "behavior") setTargetBehavior(value as "refill" | "set_aside"); else if (field === "amount") setTargetAmount(value); else if (field === "interval") selectTargetInterval(Number(value) as RecurrenceMonths); else if (field === "dueKind") setDueKind(value as "day" | "last_day"); else if (field === "dueDay") setDueDay(value); else setFirstDueMonth(value); }} onSaveTarget={saveTarget} onClearTarget={clearTarget} onSnooze={(id, value) => toggleTargetSnooze(id, value)} />;
  return <section className="plan-view" aria-labelledby="plan-title">
    <div className="plan-toolbar"><div><p className="eyebrow">MONTHLY PLAN</p><h2 id="plan-title" tabIndex={-1}>{month}</h2></div><div><button onClick={() => setMonth(shiftCalendarMonth(month, -1))}>←</button><button onClick={() => setMonth(localCalendarMonth())}>Today</button><button onClick={() => setMonth(shiftCalendarMonth(month, 1))}>→</button></div></div>
    {error && <p className="editor-error" role="alert">{error}</p>}
    {!plan || plan.month !== month ? <><div className="register-message" role="status">Loading Plan…</div><div className="plan-content loading">{detailsPanel}</div></> : <>
      <span className="sr-only" role="status">{planCurrent ? "" : "Updating Plan…"}</span>
      <div className="plan-rta"><span>Ready to Assign</span><strong>{formatHuf(BigInt(plan.readyToAssign))}</strong></div>
      {plan.creditPaymentCategories.length > 0 && <div className="plan-credit" inert={moveBusy}><strong>Credit card payment categories</strong><p>Funded card spending adds the funded portion to its mapped payment category.</p>{plan.creditPaymentCategories.map((mapping) => <label key={mapping.accountId}>{mapping.accountName}<select value={mapping.categoryId ?? ""} onChange={(event) => void mapPayment(mapping.accountId, event.target.value)}><option value="">Not mapped</option>{plan.categories.map((category) => <option key={category.categoryId} value={category.categoryId} disabled={plan.creditPaymentCategories.some((other) => other.accountId !== mapping.accountId && other.categoryId === category.categoryId)}>{category.groupName} / {category.categoryName}</option>)}</select></label>)}</div>}
      <div className="plan-content">
      <div className="plan-table" inert={moveBusy}><div className="plan-head"><span>Category</span><span>Assigned</span><span>Activity</span><span>Available</span></div>{plan.categories.map((category) => <div className={`plan-row${selectedCategoryId === category.categoryId ? " selected" : ""}`} key={category.categoryId} onClick={() => selectCategory(category.categoryId)} onFocusCapture={() => selectCategory(category.categoryId)}><button className="plan-category-name" type="button" aria-pressed={selectedCategoryId === category.categoryId} aria-controls="plan-category-details" onClick={() => selectCategory(category.categoryId)}><small>{category.groupName}</small>{category.categoryName}</button><PlanAssignmentInput month={month} category={category} readOnly={!planCurrent} onSave={save} /><span>{formatHuf(BigInt(category.activity))}</span><button type="button" data-category-id={category.categoryId} className={`plan-available ${planAvailableClass(category, plan.creditPaymentCategories)}`} title={planPaymentDescription(category, plan.creditPaymentCategories)} aria-label={`${category.categoryName} available ${formatHuf(BigInt(category.available))}${planPaymentDescription(category, plan.creditPaymentCategories) ? `; ${planPaymentDescription(category, plan.creditPaymentCategories)}` : ""}; move money`} disabled={!planCurrent || moveBusy} onClick={(event) => openMove(category, event.currentTarget)}>{formatHuf(BigInt(category.available))}</button></div>)}</div>
      {detailsPanel}
      </div>
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

type TargetEditor = { behavior: "refill" | "set_aside"; amount: string; interval: RecurrenceMonths; dueKind: "day" | "last_day"; dueDay: string; firstDueMonth: string };
function PlanAssignmentInput({ month, category, readOnly, onSave }: { month: string; category: PlanCategory; readOnly: boolean; onSave: (categoryId: string, value: string) => Promise<boolean> }) {
  const [value, setValue] = useState(category.assigned);
  const currentValue = useRef(value);
  const focused = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    if (!readOnly && !focused.current && !dirty.current) { currentValue.current = category.assigned; setValue(category.assigned); }
  }, [category.assigned, readOnly]);
  return <input className={BigInt(category.assigned) < 0n ? "plan-negative" : undefined} aria-label={`${category.categoryName} assigned`} value={value} readOnly={readOnly} onFocus={() => { focused.current = true; }} onChange={(event) => { dirty.current = true; currentValue.current = event.target.value; setValue(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={() => { focused.current = false; if (!dirty.current || currentValue.current === category.assigned) { dirty.current = false; currentValue.current = category.assigned; setValue(category.assigned); } else if (!readOnly) { const submitted = currentValue.current; void onSave(category.categoryId, submitted).then((saved) => { if (saved && currentValue.current === submitted) dirty.current = false; }); } }} data-plan-month={month} />;
}
function targetFingerprint(target: { behavior: "set_aside" | "refill"; amount: string; dueKind: "day" | "last_day"; dueDay: number | null; intervalMonths?: RecurrenceMonths; firstDueMonth?: string | null } | null): string { return target ? JSON.stringify({ behavior: target.behavior, amount: target.amount, dueKind: target.dueKind, dueDay: target.dueDay, intervalMonths: target.intervalMonths ?? 1, firstDueMonth: target.firstDueMonth ?? null }) : "none"; }
function CategoryDetailsPanel({ category, month, notes, noteStatus, noteBusy, onNotesChange, onSaveNotes, targetBusy, target, onTargetChange, onSaveTarget, onClearTarget, onSnooze, creditPayment }: { category: PlanCategory | null; creditPayment: CreditPaymentCategory | null; month: string; notes: string; noteStatus: string; noteBusy: boolean; onNotesChange: (id: string, value: string) => void; onSaveNotes: (id: string, value: string) => Promise<void>; targetBusy: boolean; target: TargetEditor; onTargetChange: (field: keyof TargetEditor, value: string) => void; onSaveTarget: (event: FormEvent) => Promise<void>; onClearTarget: () => Promise<void>; onSnooze: (id: string, value: boolean) => Promise<void> }) {
  if (!category) return <aside id="plan-category-details" className="category-details empty"><p>Select a category to see its details.</p></aside>;
  const progress = category.target;
  return <aside id="plan-category-details" className="category-details" aria-label={`${category.categoryName} details`}>
    <h3>{category.categoryName}</h3><p className="category-details-group">{category.groupName} · {month}</p>
    {creditPayment ? <CreditPaymentDetails category={category} payment={creditPayment} /> : <dl className="category-totals"><div><dt>Available</dt><dd>{formatHuf(BigInt(category.available))}</dd></div><div><dt>Assigned</dt><dd>{formatHuf(BigInt(category.assigned))}</dd></div><div><dt>Activity</dt><dd>{formatHuf(BigInt(category.activity))}</dd></div></dl>}
    {!creditPayment && <>{progress ? <section className="target-progress"><h4>Target progress</h4><p><strong>{formatHuf(BigInt(progress.neededThisMonth))}</strong> needed · {formatHuf(BigInt(progress.funded))} funded</p><p>{formatHuf(BigInt(progress.toGo))} to go · {recurrenceLabel(progress.intervalMonths)}{progress.dueMonth ? ` · Due ${progress.dueMonth}` : ""}</p><button type="button" disabled={targetBusy} onClick={() => void onSnooze(category.categoryId, !progress.snoozed)}>{progress.snoozed ? "Resume this month" : "Snooze this month"}</button>{progress.snoozed && <span> Snoozed this month</span>}</section> : <p className="target-progress-empty">No target set for this category.</p>}
    <details className="target-editor"><summary>Edit target</summary><form onSubmit={onSaveTarget}>
      <label>Target type<select disabled={targetBusy} value={target.behavior} onChange={(event) => onTargetChange("behavior", event.target.value)}><option value="refill">Refill up to</option><option value="set_aside">Set aside another</option></select></label>
      <label>Frequency<select disabled={targetBusy} value={target.interval} onChange={(event) => onTargetChange("interval", event.target.value)}><option value={1}>Monthly</option><option value={3}>Quarterly</option><option value={12}>Yearly</option></select></label>
      <label>Amount per period<input disabled={targetBusy} aria-label="Target amount" value={target.amount} onChange={(event) => onTargetChange("amount", event.target.value)} inputMode="numeric" /></label>
      {target.interval !== 1 && <label>First due month<input disabled={targetBusy} type="month" min={month} value={target.firstDueMonth} onChange={(event) => onTargetChange("firstDueMonth", event.target.value)} required /></label>}
      <label>Due date<select disabled={targetBusy} value={target.dueKind} onChange={(event) => onTargetChange("dueKind", event.target.value)}><option value="last_day">Last day of month</option><option value="day">Day of month</option></select></label>
      {target.dueKind === "day" && <label>Due day<input disabled={targetBusy} value={target.dueDay} onChange={(event) => onTargetChange("dueDay", event.target.value)} inputMode="numeric" /></label>}
      {target.interval !== 1 && <p className="target-help">The total is spread across the months through the due month, then repeats every {target.interval} months.</p>}
      <div className="target-actions"><button disabled={targetBusy || !target.amount}>Save target</button><button type="button" disabled={targetBusy || !progress} onClick={() => void onClearTarget()}>Clear</button></div>
    </form></details></>}
    <section className="category-notes"><label htmlFor={`category-notes-${category.categoryId}`}>Notes</label><textarea disabled={noteBusy} id={`category-notes-${category.categoryId}`} value={notes} onChange={(event) => onNotesChange(category.categoryId, event.target.value)} onBlur={(event) => { const value = event.currentTarget.value; if (value !== (category.notes ?? "")) void onSaveNotes(category.categoryId, value); }} rows={5} /><div><span role="status">{noteStatus === "dirty" ? "Unsaved changes" : noteStatus === "saving" ? "Saving…" : noteStatus === "error" ? "Could not save. Your draft is kept." : noteStatus === "saved" ? "Saved" : ""}</span><button type="button" disabled={noteBusy || notes === (category.notes ?? "")} onClick={() => void onSaveNotes(category.categoryId, notes)}>Save notes</button></div></section>
  </aside>;
}

function planAvailableClass(category: PlanCategory, mappings: CreditPaymentCategory[]): string {
  const payment = mappings.find((mapping) => mapping.categoryId === category.categoryId);
  if (payment) return creditPaymentStatus(payment.currentBalance, category.available).state;
  return BigInt(category.available) > 0n ? "positive" : BigInt(category.available) < 0n ? "negative" : "zero";
}

function planPaymentDescription(category: PlanCategory, mappings: CreditPaymentCategory[]): string | undefined {
  const payment = mappings.find((mapping) => mapping.categoryId === category.categoryId);
  if (!payment) return undefined;
  const state = creditPaymentStatus(payment.currentBalance, category.available).state;
  return state === "overspent" ? "Payment category overspent" : state === "underfunded" ? "Payment underfunded; not enough set aside to pay the card balance" : "Card balance fully funded";
}
