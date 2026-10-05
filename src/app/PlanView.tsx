import { useEffect, useState, type FormEvent } from "react";
import { loadPlanMonth, movePlanMoney, setCategoryTarget, setCategoryTargetSnoozed, setCreditPaymentCategory, setPlanAssignment, type PlanSnapshot, type RecurrenceMonths } from "../lib/desktop";
import { formatHuf, localCalendarMonth, parseSignedHufInput, shiftCalendarMonth } from "../lib/format";
import { recurrenceLabel } from "../lib/recurrence";

export function PlanView() {
  const [month, setMonth] = useState(localCalendarMonth());
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromCategory, setFromCategory] = useState(""); const [toCategory, setToCategory] = useState(""); const [moveAmount, setMoveAmount] = useState("");
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
  useEffect(() => { setTargetCategory(""); setTargetAmount(""); }, [month]);
  async function reload() { setPlan(await loadPlanMonth(month)); }
  useEffect(() => { let active = true; setPlan(null); setError(null); loadPlanMonth(month).then((value) => { if (active) { setPlan(value); if (!value) setError("The Plan is available in the desktop app."); } }, () => { if (active) setError("Could not load this Plan month."); }); return () => { active = false; }; }, [month]);
  async function save(categoryId: string, value: string) { try { await setPlanAssignment(categoryId, month, parseSignedHufInput(value).toString()); await reload(); } catch { setError("Enter a whole HUF assignment amount."); } }
  async function move(event: FormEvent) { event.preventDefault(); try { const amount = parseSignedHufInput(moveAmount); if (amount <= 0n) throw new Error(); await movePlanMoney(fromCategory, toCategory, month, amount.toString()); await reload(); setMoveAmount(""); setError(null); } catch { setError("Choose two different categories and a positive whole HUF amount."); } }
  async function mapPayment(accountId: string, categoryId: string) { try { await setCreditPaymentCategory(accountId, categoryId || null); await reload(); } catch { setError("Could not save this credit-card payment category."); } }
  async function saveTarget(event: FormEvent) { event.preventDefault(); try { if (!targetCategory) throw new Error(); const amount = parseSignedHufInput(targetAmount); const day = Number(dueDay); if (amount <= 0n || (dueKind === "day" && (!Number.isInteger(day) || day < 1 || day > 31))) throw new Error(); if (targetInterval !== 1 && (!firstDueMonth || firstDueMonth < month)) throw new Error(); await setCategoryTarget(targetCategory, month, { behavior: targetBehavior, amount: amount.toString(), dueKind, dueDay: dueKind === "day" ? day : null, intervalMonths: targetInterval, firstDueMonth: targetInterval === 1 ? null : firstDueMonth }); await reload(); setError(null); } catch { setError("Choose a category, a positive whole HUF amount, and a valid due date in this or a later month."); } }
  async function clearTarget() { try { if (!targetCategory) throw new Error(); await setCategoryTarget(targetCategory, month, null); await reload(); setError(null); } catch { setError("Choose a category to clear its target."); } }
  async function toggleTargetSnooze(categoryId: string, snoozed: boolean) { try { await setCategoryTargetSnoozed(categoryId, month, snoozed); await reload(); setError(null); } catch { setError("Could not update this month’s target snooze."); } }
  return <section className="plan-view" aria-labelledby="plan-title">
    <div className="plan-toolbar"><div><p className="eyebrow">MONTHLY PLAN</p><h2 id="plan-title">{month}</h2></div><div><button onClick={() => setMonth(shiftCalendarMonth(month, -1))}>←</button><button onClick={() => setMonth(localCalendarMonth())}>Today</button><button onClick={() => setMonth(shiftCalendarMonth(month, 1))}>→</button></div></div>
    {error && <p className="editor-error" role="alert">{error}</p>}
    {!plan ? <div className="register-message" role="status">Loading Plan…</div> : <>
      <div className="plan-rta"><span>Ready to Assign</span><strong>{formatHuf(BigInt(plan.readyToAssign))}</strong></div>
      <form className="plan-move" onSubmit={move}><strong>Move money</strong><select aria-label="Move money from" value={fromCategory} onChange={(event) => setFromCategory(event.target.value)}><option value="">From category</option>{plan.categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.groupName} / {category.categoryName}</option>)}</select><select aria-label="Move money to" value={toCategory} onChange={(event) => setToCategory(event.target.value)}><option value="">To category</option>{plan.categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.groupName} / {category.categoryName}</option>)}</select><input aria-label="Move amount" value={moveAmount} onChange={(event) => setMoveAmount(event.target.value)} placeholder="HUF" inputMode="numeric" /><button disabled={!fromCategory || !toCategory || !moveAmount}>Move</button></form>
      <form className="plan-target" onSubmit={saveTarget}>
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
      {plan.creditPaymentCategories.length > 0 && <div className="plan-credit"><strong>Credit card payment categories</strong><p>Funded card spending adds the funded portion to its mapped payment category.</p>{plan.creditPaymentCategories.map((mapping) => <label key={mapping.accountId}>{mapping.accountName}<select value={mapping.categoryId ?? ""} onChange={(event) => void mapPayment(mapping.accountId, event.target.value)}><option value="">Not mapped</option>{plan.categories.map((category) => <option key={category.categoryId} value={category.categoryId} disabled={plan.creditPaymentCategories.some((other) => other.accountId !== mapping.accountId && other.categoryId === category.categoryId)}>{category.groupName} / {category.categoryName}</option>)}</select></label>)}</div>}
      <div className="plan-table"><div className="plan-head"><span>Category</span><span>Assigned</span><span>Activity</span><span>Available</span></div>{plan.categories.map((category) => <div className="plan-row" key={category.categoryId}><span><small>{category.groupName}</small>{category.categoryName}{category.target && <em>{category.target.snoozed ? "Snoozed this month" : `${formatHuf(BigInt(category.target.toGo))} more needed this month ? ${recurrenceLabel(category.target.intervalMonths)}${category.target.dueMonth ? ` ? Due ${category.target.dueMonth}, ${category.target.dueKind === "last_day" ? "last day" : `day ${category.target.dueDay}`}` : ""}`} <button type="button" onClick={() => void toggleTargetSnooze(category.categoryId, !(category.target?.snoozed ?? false))}>{category.target.snoozed ? "Resume" : "Snooze"}</button></em>}</span><input key={`${month}-${category.categoryId}-${category.assigned}`} className={BigInt(category.assigned) < 0n ? "plan-negative" : undefined} aria-label={`${category.categoryName} assigned`} defaultValue={category.assigned} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { if (event.target.value !== category.assigned) void save(category.categoryId, event.target.value); }} /><span>{formatHuf(BigInt(category.activity))}</span><strong className={BigInt(category.available) < 0n ? "plan-negative" : undefined}>{formatHuf(BigInt(category.available))}</strong></div>)}</div>
    </>}
  </section>;
}
