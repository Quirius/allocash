import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RegisterEntry } from "../lib/desktop";
import { localCalendarDate } from "../lib/format";

type Props = {
  entry: RegisterEntry; x: number; y: number; disabled?: boolean; busy?: boolean;
  onClose: () => void; onEdit: () => void; onDuplicate: () => void;
  onMakeRepeating: () => void; onDelete: () => void;
  onStatusChange: (next: "cleared" | "uncleared") => void; onEditMemo?: () => void;
  onSkip?: () => void; onPost?: () => void;
};
type Item = { label: string; icon?: string; shortcut?: string; disabled?: boolean; run?: () => void; separator?: true };

export function TransactionContextMenu(props: Props) {
  const { entry } = props;
  const menu = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [position, setPosition] = useState({ left: props.x, top: props.y });
  const [active, setActive] = useState(0);
  const isPending = entry.postingState === "scheduled";
  const lockedStatus = entry.clearedState === "reconciled";
  const future = entry.date > localCalendarDate();
  const statusDisabled = !!props.disabled || isPending || lockedStatus || future;
  const scheduledActions = isPending && (props.onSkip || props.onPost);
  const cannotRepeat = (entry.repeatIntervalMonths !== null && entry.repeatIntervalMonths !== undefined && entry.repeatIntervalMonths > 0)
    || (future && entry.clearedState === "cleared" && !entry.transferId);
  const items: Item[] = [
    { label: "Edit", icon: "✎", shortcut: "E", disabled: props.disabled, run: props.onEdit },
    ...(scheduledActions ? [
      ...(props.onPost ? [{ label: "Post", icon: "↥", disabled: props.busy || props.disabled, run: props.onPost }] : []),
      ...(props.onSkip ? [{ label: "Skip", icon: "↷", disabled: props.busy || props.disabled, run: props.onSkip }] : []),
    ] : []),
    { label: "Approve", icon: "✓", disabled: true }, { label: "Reject", icon: "×", disabled: true },
    { label: "Mark as Cleared", icon: "●", disabled: statusDisabled || entry.clearedState === "cleared", run: () => props.onStatusChange("cleared") },
    { label: "Mark as Uncleared", icon: "○", disabled: statusDisabled || entry.clearedState === "uncleared", run: () => props.onStatusChange("uncleared") },
    { label: "Match", icon: "⇄", disabled: true }, { label: "Unmatch", icon: "↔", disabled: true },
    { separator: true, label: "" },
    { label: "Duplicate", icon: "▣", shortcut: "Shift D", disabled: props.disabled, run: props.onDuplicate },
    { label: "Make Repeating", icon: "⟳", shortcut: "Shift T", disabled: props.disabled || cannotRepeat, run: props.onMakeRepeating },
    { separator: true, label: "" },
    { label: "Flag", icon: "⚑", disabled: props.disabled, run: props.onEdit },
    { label: "Memo", icon: "▤", disabled: props.disabled, run: props.onEditMemo ?? props.onEdit },
    { label: "Categorize", icon: "⊞", disabled: props.disabled, run: props.onEdit },
    { label: "Edit Memo", icon: "✎", disabled: props.disabled, run: props.onEditMemo ?? props.onEdit },
    { label: "Move to Account", icon: "⇥", disabled: props.disabled, run: props.onEdit },
    { separator: true, label: "" },
    { label: "Export", icon: "⇩", disabled: true },
    { label: "Delete", icon: "⌫", shortcut: "Delete", disabled: props.disabled, run: props.onDelete },
  ];
  const enabledIndexes = items.flatMap((item, index) => !item.separator && !item.disabled ? [index] : []);
  const close = useCallback(() => { props.onClose(); previousFocus.current?.focus(); }, [props.onClose]);
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(props.x, window.innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(props.y, window.innerHeight - bounds.height - 8)) });
    node.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
  }, [props.x, props.y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) close(); };
    const resize = () => { const bounds = menu.current?.getBoundingClientRect(); if (bounds) setPosition({ left: Math.max(8, Math.min(props.x, window.innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(props.y, window.innerHeight - bounds.height - 8)) }); };
    window.addEventListener("pointerdown", outside); window.addEventListener("resize", resize); window.addEventListener("scroll", resize, true);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("resize", resize); window.removeEventListener("scroll", resize, true); };
  }, [close, props.x, props.y]);
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    const key = event.key.toLowerCase();
    const shortcut = event.key === "Delete" ? "Delete" : event.shiftKey && key === "d" ? "Shift D" : event.shiftKey && key === "t" ? "Shift T" : key === "e" && !event.shiftKey ? "E" : undefined;
    const shortcutItem = shortcut && items.find((item) => item.shortcut === shortcut && !item.disabled && item.run);
    if (shortcutItem?.run) { event.preventDefault(); close(); shortcutItem.run(); return; }
    let next: number | undefined;
    const currentIndex = enabledIndexes.indexOf(active);
    if (event.key === "ArrowDown") next = enabledIndexes[(currentIndex + 1 + enabledIndexes.length) % enabledIndexes.length];
    if (event.key === "ArrowUp") next = enabledIndexes[(currentIndex - 1 + enabledIndexes.length) % enabledIndexes.length];
    if (event.key === "Home") next = enabledIndexes[0];
    if (event.key === "End") next = enabledIndexes.at(-1);
    if (next !== undefined) { event.preventDefault(); setActive(next); menu.current?.querySelector<HTMLElement>(`[data-menu-index="${next}"]`)?.focus(); }
  }
  return createPortal(<div ref={menu} className="transaction-context-menu" role="menu" aria-label="Transaction actions" style={{ position: "fixed", left: position.left, top: position.top, zIndex: 1000 }} onKeyDown={keyDown}>
    {items.map((item, index) => item.separator ? <div key={`sep-${index}`} className="transaction-menu-separator" role="separator" /> : <button key={item.label} data-menu-index={index} type="button" role="menuitem" tabIndex={active === index ? 0 : -1} aria-disabled={item.disabled || undefined} disabled={item.disabled} onFocus={() => setActive(index)} onClick={() => { if (!item.disabled && item.run) { close(); item.run(); } }}>
      <span className="transaction-menu-label">{item.icon && <span className="transaction-menu-icon" aria-hidden="true">{item.icon}</span>}{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}
    </button>)}
  </div>, document.body);
}
