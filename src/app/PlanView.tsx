import { useEffect, useState } from "react";
import { loadPlanMonth, setPlanAssignment, type PlanSnapshot } from "../lib/desktop";
import { formatHuf, localCalendarMonth, shiftCalendarMonth } from "../lib/format";

export function PlanView() {
  const [month, setMonth] = useState(localCalendarMonth());
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; setPlan(null); setError(null); loadPlanMonth(month).then((value) => { if (active) { setPlan(value); if (!value) setError("The Plan is available in the desktop app."); } }, () => { if (active) setError("Could not load this Plan month."); }); return () => { active = false; }; }, [month]);
  async function save(categoryId: string, value: string) {
    try { await setPlanAssignment(categoryId, month, BigInt(value.trim() || "0").toString()); setPlan(await loadPlanMonth(month)); }
    catch { setError("Enter a whole HUF assignment amount."); }
  }
  return <section className="plan-view" aria-labelledby="plan-title"><div className="plan-toolbar"><div><p className="eyebrow">MONTHLY PLAN</p><h2 id="plan-title">{month}</h2></div><div><button onClick={() => setMonth(shiftCalendarMonth(month, -1))}>←</button><button onClick={() => setMonth(localCalendarMonth())}>Today</button><button onClick={() => setMonth(shiftCalendarMonth(month, 1))}>→</button></div></div>
    {error && <p className="editor-error" role="alert">{error}</p>}
    {!plan ? <div className="register-message" role="status">Loading Plan…</div> : <><div className="plan-rta"><span>Ready to Assign</span><strong>{formatHuf(BigInt(plan.readyToAssign))}</strong></div><div className="plan-table"><div className="plan-head"><span>Category</span><span>Assigned</span><span>Activity</span><span>Available</span></div>{plan.categories.map((category) => <div className="plan-row" key={category.categoryId}><span><small>{category.groupName}</small>{category.categoryName}</span><input aria-label={`${category.categoryName} assigned`} defaultValue={category.assigned} onBlur={(event) => { if (event.target.value !== category.assigned) void save(category.categoryId, event.target.value); }} /><span>{formatHuf(BigInt(category.activity))}</span><strong>{formatHuf(BigInt(category.available))}</strong></div>)}</div></>}
  </section>;
}
