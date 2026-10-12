import { AmountInput } from "./AmountInput";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { assignReadyToAssign, deleteCategory, getSavedMutationVersion, hasSavedMutationPending, loadHiddenCategories, loadPlanMonth, movePlanMoney, renameCategory, setCategoryHidden, setCategoryNotes, setCategoryTarget, setCategoryTargetSnoozed, setPlanAssignment, type CreditPaymentCategory, type HiddenCategory, type PlanCategory, type PlanSnapshot, type RecurrenceMonths } from "../lib/desktop";
import { formatHuf, localCalendarMonth, parseSignedHufInput, shiftCalendarMonth } from "../lib/format";
import { CreditPaymentDetails } from "./CreditPaymentDetails";
import { creditPaymentStatus } from "./credit-payment";
import { recurrenceLabel } from "../lib/recurrence";
import { createRequestSequence } from "../lib/request-sequence";
import { editCategoryNote, finishCategoryNoteSave, markCategoryNoteSaving, reconcileCategoryNoteDrafts, type CategoryNoteDrafts } from "./category-notes";
import { isPlanCoverAmountValid, canSubmitPlanMove, createPlanCoverPayload, createPlanMovePayload, defaultPlanMoveAmount, isPlanMoveRequestCurrent, isReadyToAssignPlanCategory, ownedPlanMoveVersion, planCoverShortfall, planMoveDestinations, READY_TO_ASSIGN_DESTINATION, READY_TO_ASSIGN_SOURCE, shouldDismissPlanMove } from "./plan-move";
import { PlanMonthArrow, PlanMonthPicker } from "./PlanMonthPicker";
import { ReadyToAssign } from "./ReadyToAssign";
import { CategoryActionsPopover } from "./CategoryActionsPopover";
import { categoryTargetPresentation, shouldShowTargetAvailableCheck } from "./plan-category-presentation";

export function PlanView({ refreshRevision = 0, readEpoch = 0, mutationPending = false, onCategoryRenamed }: { refreshRevision?: number; readEpoch?: number; mutationPending?: boolean; onCategoryRenamed?: () => Promise<void> }) {
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
  const [moveSource, setMoveSource] = useState<{ mode: "move" | "cover"; id: string; name: string; available: string; categories: PlanSnapshot["categories"]; readyToAssign: string; gap?: string; expectedAssigned?: string } | null>(null);
  const [toCategory, setToCategory] = useState(""); const [moveAmount, setMoveAmount] = useState(""); const [moveBusy, setMoveBusy] = useState(false); const moveBusyRef = useRef(false);
  const [coverSource, setCoverSource] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);
  const moveGeneration = useRef(0);
  const ownedMoveVersion = useRef<number | null>(null);
  const focusedMoveGeneration = useRef(-1);
  const popupRef = useRef<HTMLFormElement>(null); const amountRef = useRef<HTMLInputElement>(null); const coverSelectRef = useRef<HTMLSelectElement>(null); const sourceButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusCategory = useRef<string | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ left: number; top: number; above: boolean }>({ left: 0, top: 0, above: false });
  const [targetBehavior, setTargetBehavior] = useState<"set_aside" | "refill">("refill"); const [targetAmount, setTargetAmount] = useState(""); const [dueKind, setDueKind] = useState<"day" | "last_day">("last_day"); const [dueDay, setDueDay] = useState("1");
  const [targetInterval, setTargetInterval] = useState<RecurrenceMonths>(1);
  const [firstDueMonth, setFirstDueMonth] = useState(month);
  const [targetHydrationRevision, setTargetHydrationRevision] = useState(0);
  const targetDirty = useRef(false);
  const previousReadEpoch = useRef(readEpoch);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categoryPopup, setCategoryPopup] = useState<{ category: PlanCategory; anchor: HTMLButtonElement; readEpoch: number; refreshRevision: number } | null>(null);
  const [categoryPopupPosition, setCategoryPopupPosition] = useState({ left: 0, top: 0, above: false });
  const [hiddenCategories, setHiddenCategories] = useState<HiddenCategory[]>([]);
  const [hiddenCategoriesCurrent, setHiddenCategoriesCurrent] = useState(false);
  const [categoryActionBusy, setCategoryActionBusy] = useState(false);
  const [categoryActionError, setCategoryActionError] = useState<string | null>(null);
  const categoryActionBusyRef = useRef(false);
  const categoryPopupRef = useRef<HTMLDivElement>(null);
  const categoryNameInput = useRef<HTMLInputElement>(null);
  const categoryPopupGeneration = useRef(0);
  const hiddenReadGeneration = useRef(0);
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
    setMoveSource(null); setMoveAmount(""); setToCategory(""); setCoverSource(""); setMoveError(null);
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
    if (!selectedCategoryId) return;
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
  useEffect(() => { const generation = ++hiddenReadGeneration.current; setHiddenCategoriesCurrent(false); void loadHiddenCategories().then((items) => { if (generation === hiddenReadGeneration.current && items) { setHiddenCategories(items); setHiddenCategoriesCurrent(true); } }).catch(() => { if (generation === hiddenReadGeneration.current) setActionError("Hidden Categories could not refresh. Retry Plan refresh."); }); return () => { if (hiddenReadGeneration.current === generation) hiddenReadGeneration.current++; }; }, [readEpoch, refreshRevision]);
  useEffect(() => {
    if (!categoryPopup || categoryActionBusyRef.current || !planCurrent) return;
    const current = plan?.categories.find((item) => item.categoryId === categoryPopup.category.categoryId);
    if (!current || current.categoryName !== categoryPopup.category.categoryName || current.groupId !== categoryPopup.category.groupId || categoryPopup.refreshRevision !== refreshRevision) {
      categoryPopupGeneration.current++; setCategoryPopup(null);
    }
  }, [categoryPopup, plan, planCurrent, readEpoch, refreshRevision, categoryActionBusy]);
  useEffect(() => {
    const popup = categoryPopup;
    if (!popup) return;
    const reposition = () => {
      if (!popup.anchor.isConnected) { setCategoryPopup(null); return; }
      const rect = popup.anchor.getBoundingClientRect();
      const width = Math.min(categoryPopupRef.current?.offsetWidth ?? 400, window.innerWidth - 16);
      const height = categoryPopupRef.current?.offsetHeight ?? 180;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const top = rect.bottom + height + 8 <= window.innerHeight - 8 ? rect.bottom + 8 : Math.max(8, rect.top - height - 8);
      setCategoryPopupPosition({ left, top, above: top < rect.bottom });
    };
    const dismiss = (event: PointerEvent) => { if (!categoryActionBusyRef.current && !categoryPopupRef.current?.contains(event.target as Node) && !popup.anchor.contains(event.target as Node)) setCategoryPopup(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !categoryActionBusyRef.current) { setCategoryPopup(null); popup.anchor.focus({ preventScroll: true }); } };
    reposition(); document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", key); window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition); if (observer && categoryPopupRef.current) observer.observe(categoryPopupRef.current);
    categoryNameInput.current?.focus({ preventScroll: true }); categoryNameInput.current?.select();
    return () => { observer?.disconnect(); document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", key); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [categoryPopup, categoryActionError]);
  function openCategoryActions(category: PlanCategory, anchor: HTMLButtonElement) {
    if (categoryActionBusyRef.current || !canWritePlan()) return;
    selectCategory(category.categoryId);
    categoryPopupGeneration.current++;
    setCategoryActionError(null);
    setCategoryPopup({ category, anchor, readEpoch, refreshRevision });
  }
  async function categoryAction(action: "rename" | "hide" | "delete", category: PlanCategory, name?: string, destinationId?: string) {
    if (categoryActionBusyRef.current || !canWritePlan()) return;
    categoryActionBusyRef.current = true; setCategoryActionBusy(true); setCategoryActionError(null);
    const generation = categoryPopupGeneration.current;
    try {
      if (action === "rename") { if (!canWritePlan()) throw new Error("Plan is updating."); await renameCategory(category.categoryId, name ?? ""); }
      else if (action === "hide") await setCategoryHidden(category.categoryId, true);
      else await deleteCategory(category.categoryId, destinationId);
      if (action !== "rename") setHiddenCategoriesCurrent(false);
      if (generation === categoryPopupGeneration.current) setCategoryPopup(null);
      if (action !== "rename") { const read = ++hiddenReadGeneration.current; void loadHiddenCategories().then((result) => { if (read === hiddenReadGeneration.current && result) { setHiddenCategories(result); setHiddenCategoriesCurrent(true); } }).catch(() => { if (read === hiddenReadGeneration.current) { setHiddenCategoriesCurrent(false); setActionError("Category saved, but Hidden Categories could not refresh. Retry Plan refresh before making another category change."); } }); }
      try { await onCategoryRenamed?.(); }
      catch { setActionError("Category saved, but the Plan could not refresh. Retry Plan refresh before making another category change."); }
    } catch (error) { if (generation === categoryPopupGeneration.current) setCategoryActionError(error instanceof Error ? error.message : "Could not update this category. Your changes are still here."); }
    finally { categoryActionBusyRef.current = false; setCategoryActionBusy(false); }
  }
  async function unhideCategory(category: HiddenCategory) {
    if (categoryActionBusyRef.current || !canWritePlan()) return;
    categoryActionBusyRef.current = true; setCategoryActionBusy(true);
    try { await setCategoryHidden(category.categoryId, false); setHiddenCategoriesCurrent(false); const read = ++hiddenReadGeneration.current; void loadHiddenCategories().then((result) => { if (read === hiddenReadGeneration.current && result) { setHiddenCategories(result); setHiddenCategoriesCurrent(true); } }).catch(() => { if (read === hiddenReadGeneration.current) { setHiddenCategoriesCurrent(false); setActionError("Category restored, but Hidden Categories could not refresh. Retry Plan refresh before making another category change."); } }); try { await onCategoryRenamed?.(); } catch { setActionError("Category restored, but the Plan could not refresh. Retry Plan refresh before making another category change."); } }
    catch (error) { setActionError(error instanceof Error ? error.message : "Could not restore this category."); }
    finally { categoryActionBusyRef.current = false; setCategoryActionBusy(false); }
  }
  async function retryCategoryRefresh() {
    setActionError(null);
    await reload(month, readEpoch);
    try { await onCategoryRenamed?.(); } catch { setActionError("Plan refreshed, but other views could not refresh. Retry Plan refresh."); }
    try { const read = ++hiddenReadGeneration.current; const result = await loadHiddenCategories(); if (read === hiddenReadGeneration.current && result) { setHiddenCategories(result); setHiddenCategoriesCurrent(true); } } catch { setHiddenCategoriesCurrent(false); setActionError("Plan refreshed, but Hidden Categories could not refresh. Retry Plan refresh."); }
  }
  async function move(event: FormEvent) {
    event.preventDefault();
    if (!moveSource || moveBusyRef.current || !canWritePlan()) return;
    const requestedMonth = month;
    const requestedGeneration = moveGeneration.current;
    const startingVersion = getSavedMutationVersion();
    let write: () => Promise<void>;
    try {
      if (moveSource.mode === "cover") {
        if (!coverSource || !moveSource.gap || moveSource.expectedAssigned === undefined) throw new Error();
        const destination = plan?.categories.find((category) => category.categoryId === moveSource.id);
        if (!destination) throw new Error();
        const payload = createPlanCoverPayload(coverSource, moveSource.id, moveSource.gap, moveSource.expectedAssigned, destination.assigned);
        write = coverSource === READY_TO_ASSIGN_SOURCE
          ? () => assignReadyToAssign({ categoryId: moveSource.id, month: requestedMonth, amount: payload.amount, expectedAssigned: payload.expectedAssigned })
          : () => movePlanMoney(payload.fromCategoryId, payload.toCategoryId, requestedMonth, payload.amount);
      } else {
        if (!toCategory) throw new Error();
        const payload = createPlanMovePayload(moveSource.id, toCategory, parseSignedHufInput(moveAmount).toString());
        write = () => movePlanMoney(payload.fromCategoryId, payload.toCategoryId, requestedMonth, payload.amount);
      }
    }
    catch (error) { setMoveError(moveSource.mode === "cover" ? error instanceof Error && error.message.includes("changed") ? error.message : "Choose a source category to cover this amount." : "Choose a destination and a positive whole HUF amount."); return; }
    moveBusyRef.current = true; setMoveBusy(true);
    try {
      await write();
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
    setActionError(null); setMoveError(null); setMoveSource({ mode: "move", id: category.categoryId, name: category.categoryName, available: category.available, categories: plan.categories, readyToAssign: plan.readyToAssign });
    setMoveAmount(defaultPlanMoveAmount(category.available)); setToCategory(""); setCoverSource("");
  }
  function openCover(category: PlanSnapshot["categories"][number], button: HTMLButtonElement, gap: bigint) {
    if (!canWritePlan() || moveBusyRef.current || !plan || gap <= 0n) return;
    moveGeneration.current += 1;
    sourceButtonRef.current = button;
    const rect = button.getBoundingClientRect(); const width = Math.min(360, window.innerWidth - 24); const height = 160;
    const above = rect.bottom + height > window.innerHeight - 12 && rect.top > height;
    setPopupPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: above ? rect.top : Math.min(rect.bottom + 6, window.innerHeight - height - 12), above });
    setActionError(null); setMoveError(null); setMoveSource({ mode: "cover", id: category.categoryId, name: category.categoryName, available: category.available, categories: plan.categories, readyToAssign: plan.readyToAssign, gap: gap.toString(), expectedAssigned: category.assigned });
    setMoveAmount(""); setToCategory(""); setCoverSource("");
  }
  function openCategoryMoney(category: PlanSnapshot["categories"][number], button: HTMLButtonElement) {
    const state = planAvailableClass(category, plan?.creditPaymentCategories ?? []);
    if (state === "negative" || state === "overspent") { openCover(category, button, planCoverShortfall(category.available)); return; }
    if (state === "underfunded") {
      const payment = plan?.creditPaymentCategories.find((mapping) => mapping.categoryId === category.categoryId);
      openCover(category, button, planCoverShortfall(category.available, payment?.currentBalance, category.target?.toGo));
      return;
    }
    openMove(category, button);
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
    if (focusedMoveGeneration.current !== moveGeneration.current) { focusedMoveGeneration.current = moveGeneration.current; if (moveSource.mode === "cover") coverSelectRef.current?.focus(); else { amountRef.current?.focus(); amountRef.current?.select(); } }
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [moveSource, moveError, coverSource, plan]);
  useEffect(() => { if (mutationPending && !moveBusy) closeMove(false); }, [mutationPending, moveBusy]);
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
  const [planFilter, setPlanFilter] = useState("All");
  const [categorySearch, setCategorySearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const visibleCategories = (plan?.categories ?? []).filter((category) => {
    const target = category.target;
    const query = categorySearch.trim().toLocaleLowerCase();
    const matchesSearch = !query || `${category.categoryName} ${category.groupName}`.toLocaleLowerCase().includes(query);
    const payment = plan?.creditPaymentCategories.find((mapping) => mapping.categoryId === category.categoryId);
    const underfunded = payment ? creditPaymentStatus(payment.currentBalance, category.available).state !== "funded" : !!target && BigInt(target.toGo) > 0n;
    const matchesFilter = planFilter === "All" || (planFilter === "Snoozed" && !!target?.snoozed) || (planFilter === "Underfunded" && underfunded) || (planFilter === "Overfunded" && !!target && BigInt(target.funded) > BigInt(target.neededThisMonth)) || (planFilter === "Money Available" && BigInt(category.available) > 0n);
    return matchesSearch && matchesFilter;
  });
  const categoryGroups = Array.from(new Map(visibleCategories.map((category) => [category.groupId, category.groupName])).entries());
  const monthlySummary = plan ? plan.categories.reduce((summary, category) => ({
    assigned: summary.assigned + BigInt(category.assigned),
    activity: summary.activity + BigInt(category.activity),
    available: summary.available + BigInt(category.available),
    carryover: summary.carryover + BigInt(category.available) - BigInt(category.assigned) - BigInt(category.activity),
  }), { assigned: 0n, activity: 0n, available: 0n, carryover: 0n }) : null;
  const detailsPanel = <CategoryDetailsPanel key={`${selectedCategory?.categoryId ?? "none"}:${month}`} category={selectedCategory} summary={monthlySummary} creditPayment={plan?.creditPaymentCategories.find((mapping) => mapping.categoryId === selectedCategory?.categoryId) ?? null} month={plan?.month ?? month} notes={selectedCategory ? (selectedNote?.value ?? selectedCategory.notes ?? "") : ""} noteStatus={selectedNote?.status ?? ""} noteBusy={mutationPending} onNotesChange={editNotes} onSaveNotes={saveNotes} targetBusy={!planCurrent || moveBusy} target={{ behavior: targetBehavior, amount: targetAmount, interval: targetInterval, dueKind, dueDay, firstDueMonth }} onTargetChange={(field, value) => { targetDirty.current = true; if (field === "behavior") setTargetBehavior(value as "refill" | "set_aside"); else if (field === "amount") setTargetAmount(value); else if (field === "interval") selectTargetInterval(Number(value) as RecurrenceMonths); else if (field === "dueKind") setDueKind(value as "day" | "last_day"); else if (field === "dueDay") setDueDay(value); else setFirstDueMonth(value); }} onSaveTarget={saveTarget} onClearTarget={clearTarget} onSnooze={(id, value) => toggleTargetSnooze(id, value)} />;
  return <section className="plan-view" aria-labelledby="plan-title">
    <div className="plan-toolbar"><div className="plan-month-nav"><PlanMonthArrow direction="previous" disabled={month <= "0001-01"} onClick={() => setMonth(shiftCalendarMonth(month, -1))} /><h2 id="plan-title" tabIndex={-1}><PlanMonthPicker month={month} onMonthChange={setMonth} /></h2><PlanMonthArrow direction="next" disabled={month >= "9999-12"} onClick={() => setMonth(shiftCalendarMonth(month, 1))} /></div>{plan && plan.month === month ? <ReadyToAssign plan={plan} planCurrent={planCurrent} canWrite={canWritePlan} readEpoch={readEpoch} mutationPending={mutationPending} onError={(message) => setActionError(message)} /> : <div className="plan-rta"><span>Ready to Assign</span><strong>—</strong></div>}<button className="plan-today" onClick={() => setMonth(localCalendarMonth())}>Today</button></div>
    {error && <p className="editor-error" role="alert">{error}{(loadError || actionError?.includes("Retry Plan refresh")) && <button type="button" onClick={() => void retryCategoryRefresh()}>Retry Plan refresh</button>}</p>}
    {!plan || plan.month !== month ? <><div className="register-message" role="status">Loading Plan…</div><div className="plan-content loading">{detailsPanel}</div></> : <>
      <span className="sr-only" role="status">{planCurrent ? "" : "Updating Plan…"}</span>
      <div className="plan-content">
      <div className="plan-main">
      <nav className="plan-filters" aria-label="Filter categories">{["All", "Snoozed", "Underfunded", "Overfunded", "Money Available"].map((filter) => <button key={filter} type="button" className={planFilter === filter ? "active" : ""} aria-pressed={planFilter === filter} onClick={() => setPlanFilter(filter)}>{filter}</button>)}</nav>
      <label className="plan-search"><span className="sr-only">Search categories</span><input value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder="Search categories" /></label>
      <div className="plan-table" inert={moveBusy}><div className="plan-head"><span>Category</span><span>Assigned</span><span>Activity</span><span>Available</span></div>{categoryGroups.map(([groupId, groupName]) => {
        const groupCategories = visibleCategories.filter((category) => category.groupId === groupId);
        const groupAssigned = groupCategories.reduce((sum, category) => sum + BigInt(category.assigned), 0n);
        const groupActivity = groupCategories.reduce((sum, category) => sum + BigInt(category.activity), 0n);
        const groupAvailable = groupCategories.reduce((sum, category) => sum + BigInt(category.available), 0n);
        const hasCreditPaymentCategory = plan.creditPaymentCategories.some((mapping) => mapping.categoryId !== null && groupCategories.some((category) => category.categoryId === mapping.categoryId));
        return <div className="plan-group" key={groupId}><button type="button" className="plan-group-heading" aria-expanded={!collapsedGroups[groupId]} onClick={() => setCollapsedGroups((current) => ({ ...current, [groupId]: !current[groupId] }))}><span className="plan-group-title"><GroupChevron collapsed={!!collapsedGroups[groupId]} />{hasCreditPaymentCategory && <BankCardIcon />}<span>{groupName}</span></span><span>{formatHuf(groupAssigned)}</span><span>{formatHuf(groupActivity)}</span><span>{formatHuf(groupAvailable)}</span></button>{!collapsedGroups[groupId] && groupCategories.map((category) => {
          const target = category.target;
          const isCreditPayment = plan.creditPaymentCategories.some((mapping) => mapping.categoryId === category.categoryId);
          const targetPresentation = target ? categoryTargetPresentation(target, category.activity, category.available, month) : null;
          const targetCheck = shouldShowTargetAvailableCheck(target, category.available, isCreditPayment);
          const availableState = planAvailableClass(category, plan.creditPaymentCategories);
          const payment = plan.creditPaymentCategories.find((mapping) => mapping.categoryId === category.categoryId);
          const coverGap = availableState === "negative" || availableState === "overspent" ? planCoverShortfall(category.available) : availableState === "underfunded" ? planCoverShortfall(category.available, payment?.currentBalance, target?.toGo) : 0n;
          const denominator = target ? BigInt(target.neededThisMonth) : 0n;
          const percent = target && denominator > 0n ? Math.max(0, Math.min(100, Number(BigInt(target.funded) * 10000n / denominator) / 100)) : null;
          return <div className={"plan-row" + (selectedCategoryId === category.categoryId ? " selected" : "")} key={category.categoryId} onClick={(event) => {
            selectCategory(category.categoryId);
            if (!canWritePlan() || (event.target instanceof Element && event.target.closest("input, select, textarea, button"))) return;
            const assigned = event.currentTarget.querySelector<HTMLInputElement>("input[data-plan-month]");
            if (assigned && !assigned.readOnly && !assigned.disabled) { assigned.focus({ preventScroll: true }); assigned.select(); }
          }} onContextMenu={(event) => {
            if (event.target instanceof Element && event.target.closest("input, select, textarea")) return;
            event.preventDefault();
            const anchor = event.currentTarget.querySelector<HTMLButtonElement>(".plan-category-name");
            if (anchor) openCategoryActions(category, anchor);
          }} onFocusCapture={() => selectCategory(category.categoryId)}>
            <div className="plan-category-cell">
              <span className="plan-category-topline">
                <button className="plan-category-name" type="button" disabled={categoryActionBusy} aria-pressed={selectedCategoryId === category.categoryId} aria-haspopup="dialog" aria-expanded={categoryPopup?.category.categoryId === category.categoryId} aria-controls="plan-category-details" onClick={(event) => { event.stopPropagation(); openCategoryActions(category, event.currentTarget); }}><span className="plan-category-label">{category.categoryName}</span></button>
                {targetPresentation && <span className={"plan-category-progress" + (targetPresentation.fullySpent ? " fully-spent" : "")}><strong>{targetPresentation.status}</strong>{targetPresentation.detail && <span>{targetPresentation.detail}</span>}</span>}
              </span>
              {target && <span className={"plan-target-meter" + (target.snoozed ? " snoozed" : "")} aria-label={targetPresentation?.status + "; " + targetPresentation?.detail}><i style={{ width: (percent ?? 100) + "%" }} /></span>}
            </div>
            <PlanAssignmentInput month={month} category={category} readOnly={!planCurrent} onSave={save} />
            <span>{formatHuf(BigInt(category.activity))}</span>
            <button type="button" data-category-id={category.categoryId} className={"plan-available " + availableState + (targetCheck ? " target-funded" + (BigInt(category.available) === 0n ? " fully-spent" : "") : "")} title={coverGap > 0n ? "Cover " + formatHuf(coverGap) + " for " + category.categoryName : planPaymentDescription(category, plan.creditPaymentCategories)} aria-label={category.categoryName + " available " + formatHuf(BigInt(category.available)) + (coverGap > 0n ? "; cover " + formatHuf(coverGap) : planPaymentDescription(category, plan.creditPaymentCategories) ? "; " + planPaymentDescription(category, plan.creditPaymentCategories) : "") + (coverGap > 0n ? "; cover money into this category" : "; move money from this category")} disabled={!planCurrent || moveBusy} onClick={(event) => openCategoryMoney(category, event.currentTarget)}>
              {targetCheck && <FundedCheckIcon />}<span>{formatHuf(BigInt(category.available))}</span>
            </button>
          </div>;
        })}</div>;
      })}{visibleCategories.length === 0 && <p className="plan-empty-results">No categories match this filter.</p>}</div>
      {hiddenCategoriesCurrent && hiddenCategories.length > 0 && <details className="plan-hidden-categories"><summary>Hidden Categories ({hiddenCategories.length})</summary><ul>{hiddenCategories.map((category) => <li key={category.categoryId}><span>{category.categoryName}<small>{category.groupName}</small></span><button type="button" disabled={!canWritePlan() || !hiddenCategoriesCurrent || categoryActionBusy} onClick={() => void unhideCategory(category)}>Unhide</button></li>)}</ul></details>}
      </div>
      {detailsPanel}
      </div>
    </>}
      {moveSource && <form ref={popupRef} className={moveSource.mode === "cover" ? "plan-move-popup plan-cover-popup" : "plan-move-popup"} style={{ left: popupPosition.left, top: popupPosition.top, transform: popupPosition.above ? "translateY(-100%)" : undefined }} onSubmit={move} aria-label={moveSource.mode === "cover" ? `Cover money into ${moveSource.name}` : `Move money out of ${moveSource.name}`}>
        {moveSource.mode === "cover" ? <>
          <strong>Cover overspending from</strong>
          <label>Source<select ref={coverSelectRef} aria-label="Cover overspending from" disabled={moveBusy} value={coverSource} onChange={(event) => setCoverSource(event.target.value)}><option value="">Choose source</option><option value={READY_TO_ASSIGN_SOURCE}>Ready to Assign — {formatHuf(BigInt(moveSource.readyToAssign))}</option>{Array.from(new Set(moveSource.categories.filter((category) => !isReadyToAssignPlanCategory(category)).map((category) => category.groupName))).map((group) => <optgroup key={group} label={group}>{planMoveDestinations(moveSource.categories.filter((category) => category.groupName === group && !isReadyToAssignPlanCategory(category)), moveSource.id).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName} — {formatHuf(BigInt(category.available))}</option>)}</optgroup>)}</select></label>
          <p className="plan-cover-gap">Cover {formatHuf(BigInt(moveSource.gap ?? "0"))} for {moveSource.name}</p>
          {!isPlanCoverAmountValid(moveSource.gap ?? "") && <p className="editor-error" role="alert">This amount is too large for one cover action. Adjust Assigned in smaller amounts.</p>}
          {moveError && <p className="editor-error" role="alert">{moveError}</p>}
          <div><button type="button" disabled={moveBusy} onClick={() => closeMove()}>Cancel</button><button type="submit" disabled={!coverSource || !isPlanCoverAmountValid(moveSource.gap ?? "") || !planCurrent || moveBusy || mutationPending}>{moveBusy ? "Saving…" : "OK"}</button></div>
        </> : <>
          <strong>Move from {moveSource.name}</strong>
          <label>Amount<AmountInput ref={amountRef} aria-label="Move amount" disabled={moveBusy} value={moveAmount} onChange={(event) => setMoveAmount(event.target.value)} placeholder="HUF" inputMode="numeric" /></label>
          <label>To<select aria-label="Move money to" disabled={moveBusy} value={toCategory} onChange={(event) => setToCategory(event.target.value)}><option value="">Choose destination</option><option value={READY_TO_ASSIGN_DESTINATION}>Ready to Assign — {formatHuf(BigInt(moveSource.readyToAssign))}</option>{Array.from(new Set(moveSource.categories.map((category) => category.groupName))).map((group) => <optgroup key={group} label={group}>{planMoveDestinations(moveSource.categories.filter((category) => category.groupName === group), moveSource.id).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName} — {formatHuf(BigInt(category.available))}</option>)}</optgroup>)}</select></label>
          {moveError && <p className="editor-error" role="alert">{moveError}</p>}
          <div><button type="button" disabled={moveBusy} onClick={() => closeMove()}>Cancel</button><button type="submit" disabled={!canSubmitPlanMove(moveSource.id, toCategory, moveAmount) || moveBusy || mutationPending}>{moveBusy ? "Saving…" : "Move"}</button></div>
        </>}
      </form>}
      {categoryPopup && <CategoryActionsPopover key={categoryPopup.category.categoryId} ref={categoryPopupRef} inputRef={categoryNameInput} category={categoryPopup.category} destinations={(plan?.categories ?? []).filter((item) => item.categoryId !== categoryPopup.category.categoryId && !plan?.creditPaymentCategories.some((mapping) => mapping.categoryId === item.categoryId) && !isReadyToAssignPlanCategory(item))} protectedCategory={plan?.creditPaymentCategories.some((mapping) => mapping.categoryId === categoryPopup.category.categoryId) ?? false} position={categoryPopupPosition} canWrite={canWritePlan()} saving={categoryActionBusy} error={categoryActionError} onRename={(name) => void categoryAction("rename", categoryPopup.category, name)} onHide={() => void categoryAction("hide", categoryPopup.category)} onDelete={(destinationId) => void categoryAction("delete", categoryPopup.category, undefined, destinationId)} onCancel={() => setCategoryPopup(null)} />}
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
  return <span className={"plan-assignment-field" + (value !== category.assigned ? " has-draft" : "")}><AmountInput className={BigInt(category.assigned) < 0n ? "plan-negative" : undefined} aria-label={`${category.categoryName} assigned`} value={value} readOnly={readOnly} onFocus={() => { focused.current = true; }} onChange={(event) => { dirty.current = true; currentValue.current = event.target.value; setValue(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={() => { focused.current = false; if (!dirty.current || currentValue.current === category.assigned) { dirty.current = false; currentValue.current = category.assigned; setValue(category.assigned); } else if (!readOnly) { const submitted = currentValue.current; void onSave(category.categoryId, submitted).then((saved) => { if (saved && currentValue.current === submitted) dirty.current = false; }); } }} data-plan-month={month} /><span className="plan-assigned-display" aria-hidden="true">{formatHuf(BigInt(category.assigned))}</span></span>;
}
function GroupChevron({ collapsed }: { collapsed: boolean }) { return <svg className={"plan-group-chevron" + (collapsed ? " collapsed" : "")} aria-hidden="true" viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3" /></svg>; }
function BankCardIcon() { return <svg className="plan-bank-card" aria-hidden="true" viewBox="0 0 20 16"><rect x="1" y="2" width="18" height="12" rx="1" fill="#31b9d8" stroke="none" /><path d="M1 5h18" stroke="#d9d9e7" strokeWidth="3" /><path d="M4 10h5" stroke="#fff" strokeWidth="2" /></svg>; }
function FundedCheckIcon() { return <svg className="plan-funded-check" aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" /><path d="m4.2 8.2 2.3 2.2 5-5" /></svg>; }
function targetFingerprint(target: { behavior: "set_aside" | "refill"; amount: string; dueKind: "day" | "last_day"; dueDay: number | null; intervalMonths?: RecurrenceMonths; firstDueMonth?: string | null } | null): string { return target ? JSON.stringify({ behavior: target.behavior, amount: target.amount, dueKind: target.dueKind, dueDay: target.dueDay, intervalMonths: target.intervalMonths ?? 1, firstDueMonth: target.firstDueMonth ?? null }) : "none"; }
function CategoryDetailsPanel({ category, summary, month, notes, noteStatus, noteBusy, onNotesChange, onSaveNotes, targetBusy, target, onTargetChange, onSaveTarget, onClearTarget, onSnooze, creditPayment }: { category: PlanCategory | null; summary: { assigned: bigint; activity: bigint; available: bigint; carryover: bigint } | null; creditPayment: CreditPaymentCategory | null; month: string; notes: string; noteStatus: string; noteBusy: boolean; onNotesChange: (id: string, value: string) => void; onSaveNotes: (id: string, value: string) => Promise<void>; targetBusy: boolean; target: TargetEditor; onTargetChange: (field: keyof TargetEditor, value: string) => void; onSaveTarget: (event: FormEvent) => Promise<void>; onClearTarget: () => Promise<void>; onSnooze: (id: string, value: boolean) => Promise<void> }) {
  if (!category) return <aside id="plan-category-details" className="category-details empty" aria-label={`${month} visible category summary`}><h3>{month}</h3><dl className="plan-summary"><div><dt>Assigned</dt><dd>{summary ? formatHuf(summary.assigned) : "—"}</dd></div><div><dt>Activity</dt><dd>{summary ? formatHuf(summary.activity) : "—"}</dd></div><div><dt>Category Available</dt><dd>{summary ? formatHuf(summary.available) : "—"}</dd></div><div><dt>Carryover</dt><dd>{summary ? formatHuf(summary.carryover) : "—"}</dd></div></dl><p>Visible category totals. Ready to Assign is shown above.</p></aside>;
  const progress = category.target;
  return <aside id="plan-category-details" className="category-details" aria-label={`${category.categoryName} details`}>
    <h3>{category.categoryName}</h3><p className="category-details-group">{category.groupName} · {month}</p>
    {creditPayment ? <CreditPaymentDetails category={category} payment={creditPayment} /> : <dl className="category-totals"><div><dt>Available</dt><dd>{formatHuf(BigInt(category.available))}</dd></div><div><dt>Assigned</dt><dd>{formatHuf(BigInt(category.assigned))}</dd></div><div><dt>Activity</dt><dd>{formatHuf(BigInt(category.activity))}</dd></div></dl>}
    {!creditPayment && <>{progress ? <section className="target-progress"><h4>Target progress</h4><p><strong>{formatHuf(BigInt(progress.neededThisMonth))}</strong> needed · {formatHuf(BigInt(progress.funded))} funded</p><p>{formatHuf(BigInt(progress.toGo))} to go · {recurrenceLabel(progress.intervalMonths)}{progress.dueMonth ? ` · Due ${progress.dueMonth}` : ""}</p><button type="button" disabled={targetBusy} onClick={() => void onSnooze(category.categoryId, !progress.snoozed)}>{progress.snoozed ? "Resume this month" : "Snooze this month"}</button>{progress.snoozed && <span> Snoozed this month</span>}</section> : <p className="target-progress-empty">No target set for this category.</p>}
    <details className="target-editor"><summary>Edit target</summary><form onSubmit={onSaveTarget}>
      <label>Target type<select disabled={targetBusy} value={target.behavior} onChange={(event) => onTargetChange("behavior", event.target.value)}><option value="refill">Refill up to</option><option value="set_aside">Set aside another</option></select></label>
      <label>Frequency<select disabled={targetBusy} value={target.interval} onChange={(event) => onTargetChange("interval", event.target.value)}><option value={1}>Monthly</option><option value={3}>Quarterly</option><option value={12}>Yearly</option></select></label>
      <label>Amount per period<AmountInput disabled={targetBusy} aria-label="Target amount" value={target.amount} onChange={(event) => onTargetChange("amount", event.target.value)} inputMode="numeric" /></label>
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
