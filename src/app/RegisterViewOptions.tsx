import { useEffect, useRef, useState } from "react";
import type { RegisterViewOptions, RegisterDatePreset } from "./register-view";

const presets: RegisterDatePreset[] = ["ThisMonth", "LastMonth", "Latest3Months", "ThisYear", "LastYear", "AllDates"];
const labels: Record<RegisterDatePreset, string> = { ThisMonth: "This month", LastMonth: "Last month", Latest3Months: "Latest 3 months", ThisYear: "This year", LastYear: "Last year", AllDates: "All dates", Custom: "Custom" };

export function RegisterViewOptionsPopup({ value, onApply, onClose, allAccounts, earliestMonth, latestMonth, onResetWidths }: { value: RegisterViewOptions; onApply: (value: RegisterViewOptions) => void; onClose: () => void; allAccounts: boolean; earliestMonth: string; latestMonth: string; onResetWidths: () => void }) {
  const [draft, setDraft] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const outside = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) onClose(); };
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); };
  }, [onClose]);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const earliest = earliestMonth || currentMonth;
  useEffect(() => { if (value.datePreset === "AllDates") setDraft({ ...value, customFromMonth: earliest, customToMonth: latestMonth || currentMonth }); }, []);
  const maxYear = Math.max(now.getFullYear() + 10, Number(latestMonth.slice(0, 4)) || 0, Number(value.customToMonth.slice(0, 4)) || 0, Number(value.customFromMonth.slice(0, 4)) || 0);
  const minYear = Math.min(Number(earliest.slice(0, 4)), now.getFullYear() - 1, Number(draft.customFromMonth.slice(0, 4)) || now.getFullYear(), Number(draft.customToMonth.slice(0, 4)) || now.getFullYear());
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index);
  const monthNames = Array.from({ length: 12 }, (_, index) => new Date(2020, index, 1).toLocaleString(undefined, { month: "long" }));
  const presetRange = (preset: RegisterDatePreset): [string, string] => {
    const y = now.getFullYear(); const m = now.getMonth() + 1;
    if (preset === "ThisMonth") return [currentMonth, currentMonth];
    if (preset === "LastMonth") { const d = new Date(y, m - 2, 1); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; return [k, k]; }
    if (preset === "Latest3Months") { const d = new Date(y, m - 3, 1); return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, currentMonth]; }
    if (preset === "ThisYear") return [`${y}-01`, `${y}-12`];
    if (preset === "LastYear") return [`${y - 1}-01`, `${y - 1}-12`];
    return [earliest, latestMonth || currentMonth];
  };
  const setPreset = (preset: RegisterDatePreset) => { const [customFromMonth, customToMonth] = presetRange(preset); setDraft({ ...draft, datePreset: preset, customFromMonth, customToMonth }); };
  const setPart = (which: "customFromMonth" | "customToMonth", part: "year" | "month", value: string) => {
    const old = draft[which].split("-"); const year = part === "year" ? value : old[0] || String(now.getFullYear()); const month = part === "month" ? value : old[1] || "01";
    setDraft({ ...draft, [which]: `${year}-${month.padStart(2, "0")}`, datePreset: "Custom" });
  };
  const monthLabel = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  const monthYearSelect = (which: "customFromMonth" | "customToMonth", name: string) => {
    const [year = String(now.getFullYear()), month = "01"] = draft[which].split("-");
    const monthIndexes = Array.from({ length: 12 }, (_, i) => i + 1);
    return <div className="register-month-year"><label>{name} month<select aria-label={`${name} month`} value={month} onChange={(e) => setPart(which, "month", e.target.value)}>{monthIndexes.map((i) => <option key={i} value={String(i).padStart(2, "0")}>{monthNames[i - 1]}</option>)}</select></label><label>{name} year<select aria-label={`${name} year`} value={year} onChange={(e) => setPart(which, "year", e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label></div>;
  };
  return <div className="register-view-popup" ref={root} role="dialog" aria-label="View Options">
    <header><strong>View Options</strong><button type="button" aria-label="Close view options" onClick={onClose}>×</button></header>
    <fieldset><legend>Date</legend><div className="register-view-presets">{presets.map((preset) => <button type="button" key={preset} className={draft.datePreset === preset ? "selected" : ""} onClick={() => setPreset(preset)}>{labels[preset]}</button>)}</div>
      <div className="register-date-range">{monthYearSelect("customFromMonth", "From")}{monthYearSelect("customToMonth", "To")}</div>
      {draft.datePreset === "Custom" && draft.customFromMonth > draft.customToMonth && <p role="alert">From month must be before or equal to To month.</p>}
    </fieldset>
    <fieldset><legend>Show</legend><label><input type="checkbox" checked={draft.showReconciled} onChange={(e) => setDraft({ ...draft, showReconciled: e.target.checked })}/> Show Reconciled Transactions</label><label><input type="checkbox" checked={draft.showFlags} onChange={(e) => setDraft({ ...draft, showFlags: e.target.checked })}/> Show Flags</label>{!allAccounts && <label><input type="checkbox" checked={draft.showRunningBalance} onChange={(e) => setDraft({ ...draft, showRunningBalance: e.target.checked })}/> Show Running Balance</label>}</fieldset>
    <footer className="register-view-footer"><span/><button type="button" onClick={onClose}>Cancel</button><button type="button" className="apply" disabled={draft.datePreset === "Custom" && draft.customFromMonth > draft.customToMonth} onClick={() => onApply({ ...draft, showRunningBalance: allAccounts ? false : draft.showRunningBalance })}>Apply</button><button type="button" onClick={onResetWidths}>Reset column widths</button></footer>
    <span className="sr-only">Current month {monthLabel(currentMonth)}</span>
  </div>;
}
