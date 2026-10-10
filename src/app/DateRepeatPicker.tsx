import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

export function nextRepeatDate(originalDate: string, today: string): string {
  formatDate(originalDate);
  formatDate(today);
  const originalDay = Number(originalDate.slice(8));
  const thisMonth = today.slice(0, 7);
  const current = dateInMonth(thisMonth, Math.min(originalDay, dayCount(thisMonth)));
  if (current > today) return current;
  const nextMonth = shiftCalendarMonth(thisMonth, 1);
  return dateInMonth(nextMonth, Math.min(originalDay, dayCount(nextMonth)));
}

export function DateRepeatPicker({ date, onDateChange, repeat, onRepeatChange, disabled = false }:
  { date: string; onDateChange: (date: string) => void; repeat?: EntryRepeat; onRepeatChange?: (repeat: EntryRepeat) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(monthOf(date));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const height = popover.current?.offsetHeight ?? 360;
      const width = popover.current?.offsetWidth ?? 260;
      const below = bounds.bottom + 6;
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, bounds.top - height - 6);
      setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)), top });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open, visibleMonth, repeat]);
  useEffect(() => { if (!open) setVisibleMonth(monthOf(date)); }, [date, open]);
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }
    function onPointerDown(event: PointerEvent) { if (!root.current?.contains(event.target as Node) && !popover.current?.contains(event.target as Node)) setOpen(false); }
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
    {open && createPortal(<div ref={popover} className="date-repeat-popover" role="dialog" aria-label="Choose date and repeat" style={{ position: "fixed", left: position.left, top: position.top, maxHeight: "calc(100dvh - 16px)", overflowY: "auto", zIndex: 20 }}>
      <div className="calendar-navigation"><button type="button" aria-label="Previous month" disabled={visibleMonth <= "0001-01"} onClick={() => { if (visibleMonth > "0001-01") setVisibleMonth(shiftCalendarMonth(visibleMonth, -1)); }}>Prev</button><strong>{calendarMonthLabel(visibleMonth)}</strong><button type="button" aria-label="Next month" disabled={visibleMonth >= "9999-12"} onClick={() => { if (visibleMonth < "9999-12") setVisibleMonth(shiftCalendarMonth(visibleMonth, 1)); }}>Next</button></div>
      <label className="calendar-keyboard-date">Enter date<input autoFocus type="date" value={date} onChange={(event) => { onDateChange(event.target.value); if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setVisibleMonth(monthOf(event.target.value)); }} /></label>
      <div className="calendar-grid" role="group" aria-label="Calendar days">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <span key={day} className="calendar-weekday">{day}</span>)}{cells.map((day, index) => day === null ? <span key={`empty-${index}`} /> : <button key={day} type="button" aria-label={formatDate(dateInMonth(visibleMonth, day))} aria-pressed={date === dateInMonth(visibleMonth, day)} onClick={() => onDateChange(dateInMonth(visibleMonth, day))}>{day}</button>)}</div>
      {repeat !== undefined && onRepeatChange && <label className="calendar-repeat">Repeat<select value={repeat} onChange={(event) => onRepeatChange(event.target.value as EntryRepeat)}><option value="never">Never</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>}
      <button type="button" className="calendar-done" onClick={() => setOpen(false)}>Done</button>
    </div>, document.body)}
  </div>;
}

function calendarMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(2000, monthNumber! - 1, 1))} ${year}`;
}
