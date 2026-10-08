import { useEffect, useRef, useState } from "react";
import { formatDate, localCalendarMonth, shiftCalendarMonth } from "../lib/format";
import type { EntryRepeat } from "../lib/transaction";

function monthOf(date: string) { return /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date) && Number(date.slice(0, 4)) >= 1 ? date.slice(0, 7) : localCalendarMonth(); }
function dayCount(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthNumber! - 1]!;
}
function dateInMonth(month: string, day: number) { return `${month}-${day.toString().padStart(2, "0")}`; }
function safeFormatDate(date: string) { try { return formatDate(date); } catch { return "Choose date"; } }

export function nextCalendarMonth(date: string): string {
  const nextMonth = shiftCalendarMonth(monthOf(date), 1);
  return dateInMonth(nextMonth, Math.min(Number(date.slice(8)), dayCount(nextMonth)));
}

export function DateRepeatPicker({ date, onDateChange, repeat, onRepeatChange, disabled = false }:
  { date: string; onDateChange: (date: string) => void; repeat?: EntryRepeat; onRepeatChange?: (repeat: EntryRepeat) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(monthOf(date));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!open) setVisibleMonth(monthOf(date)); }, [date, open]);
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }
    function onPointerDown(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    window.addEventListener("keydown", onKeyDown); window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("pointerdown", onPointerDown); };
  }, [open]);
  const firstWeekday = (() => {
    const [yearRaw, monthRaw] = visibleMonth.split("-").map(Number);
    const year = monthRaw! < 3 ? yearRaw! - 1 : yearRaw!;
    const month = monthRaw! < 3 ? monthRaw! + 12 : monthRaw!;
    const weekday = (1 + Math.floor((13 * (month + 1)) / 5) + year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400)) % 7;
    return (weekday + 6) % 7;
  })();
  const count = dayCount(visibleMonth);
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  return <div className="date-repeat-picker" ref={root}>
    <span className="date-repeat-label">Date</span>
    <button ref={trigger} type="button" className="date-picker-trigger" aria-label={`${safeFormatDate(date)}${repeat && repeat !== "never" ? `, repeats ${repeat}` : ""}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>{safeFormatDate(date)}{repeat && repeat !== "never" ? ` · ${repeat[0]!.toUpperCase()}${repeat.slice(1)}` : ""}</button>
    {open && <div className="date-repeat-popover" role="dialog" aria-label="Choose date and repeat">
      <div className="calendar-navigation"><button type="button" aria-label="Previous month" disabled={visibleMonth <= "0001-01"} onClick={() => { if (visibleMonth > "0001-01") setVisibleMonth(shiftCalendarMonth(visibleMonth, -1)); }}>Prev</button><strong>{calendarMonthLabel(visibleMonth)}</strong><button type="button" aria-label="Next month" disabled={visibleMonth >= "9999-12"} onClick={() => { if (visibleMonth < "9999-12") setVisibleMonth(shiftCalendarMonth(visibleMonth, 1)); }}>Next</button></div>
      <label className="calendar-keyboard-date">Enter date<input autoFocus type="date" value={date} onChange={(event) => { onDateChange(event.target.value); if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setVisibleMonth(monthOf(event.target.value)); }} /></label>
      <div className="calendar-grid" role="group" aria-label="Calendar days">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <span key={day} className="calendar-weekday">{day}</span>)}{cells.map((day, index) => day === null ? <span key={`empty-${index}`} /> : <button key={day} type="button" aria-label={formatDate(dateInMonth(visibleMonth, day))} aria-pressed={date === dateInMonth(visibleMonth, day)} onClick={() => onDateChange(dateInMonth(visibleMonth, day))}>{day}</button>)}</div>
      {repeat !== undefined && onRepeatChange && <label className="calendar-repeat">Repeat<select value={repeat} onChange={(event) => onRepeatChange(event.target.value as EntryRepeat)}><option value="never">Never</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>}
      <button type="button" className="calendar-done" onClick={() => setOpen(false)}>Done</button>
    </div>}
  </div>;
}

function calendarMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(2000, monthNumber! - 1, 1))} ${year}`;
}
