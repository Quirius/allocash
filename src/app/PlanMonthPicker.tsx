import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

function monthLabel(month: string) {
  const [year, number] = month.split("-").map(Number);
  return `${new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(2000, number! - 1, 1))} ${year}`;
}

function CircleArrow({ direction }: { direction: "previous" | "next" }) {
  return <svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14.25"/><path d={direction === "previous" ? "M18.5 10.5 13 16l5.5 5.5" : "M13.5 10.5 19 16l-5.5 5.5"}/></svg>;
}

export function PlanMonthPicker({ month, onMonthChange }: { month: string; onMonthChange: (month: string) => void }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const selectedMonth = Number(month.slice(5, 7));

  useEffect(() => { if (!open) setYear(Number(month.slice(0, 4))); }, [month, open]);
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(popup.current?.offsetWidth ?? 320, window.innerWidth - 16);
      const height = popup.current?.offsetHeight ?? 230;
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
      const below = bounds.bottom + 9;
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, bounds.top - height - 9);
      setPosition({ left, top });
    };
    reposition();
    const selected = popup.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    (selected ?? popup.current?.querySelector<HTMLButtonElement>(".plan-month-grid button"))?.focus({ preventScroll: true });
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open, year]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !root.current?.contains(target) && !popup.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("pointerdown", onPointerDown); };
  }, [open]);

  const shiftYear = (delta: number) => setYear((value) => Math.max(MIN_YEAR, Math.min(MAX_YEAR, value + delta)));
  return <span className="plan-month-picker" ref={root}>
    <button ref={trigger} type="button" className="plan-month-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={`Plan month, ${monthLabel(month)}`} onClick={() => setOpen((value) => !value)}>{monthLabel(month)}<svg aria-hidden="true" viewBox="0 0 12 8"><path d="m1 1 5 5 5-5"/></svg></button>
    {open && createPortal(<div ref={popup} className="plan-month-popup" role="dialog" aria-label="Choose Plan month" style={{ position: "fixed", left: position.left, top: position.top, zIndex: 1100, maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100dvh - 16px)" }}>
      <div className="plan-month-popup-notch" />
      <div className="plan-month-popup-scroll">
      <div className="plan-month-year"><button type="button" aria-label="Previous year" disabled={year <= MIN_YEAR} onClick={() => shiftYear(-1)}><CircleArrow direction="previous" /></button><strong>{year}</strong><button type="button" aria-label="Next year" disabled={year >= MAX_YEAR} onClick={() => shiftYear(1)}><CircleArrow direction="next" /></button></div>
      <div className="plan-month-grid" role="group" aria-label={`${year} months`}>
        {MONTHS.map((name, index) => { const number = index + 1; const value = `${String(year).padStart(4, "0")}-${String(number).padStart(2, "0")}`; const active = year === Number(month.slice(0, 4)) && number === selectedMonth;
          return <button type="button" key={name} aria-pressed={active} className={active ? "active" : ""} onClick={() => { onMonthChange(value); setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>{name}</button>;
        })}
      </div>
      </div>
    </div>, document.body)}
  </span>;
}

export function PlanMonthArrow({ direction, onClick, disabled }: { direction: "previous" | "next"; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="plan-month-arrow" aria-label={`${direction === "previous" ? "Previous" : "Next"} month`} disabled={disabled} onClick={onClick}><CircleArrow direction={direction} /></button>;
}

