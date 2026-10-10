import type { ClearedState } from "../lib/desktop";

export function TransactionStatusIcon({ state, pending = false, disabled = false, onToggle }:
  { state: Exclude<ClearedState, "reconciled"> | "reconciled"; pending?: boolean; disabled?: boolean; onToggle?: () => void }) {
  if (pending) return null;
  const reconciled = state === "reconciled";
  const label = reconciled ? "Reconciled" : state === "cleared" ? "Mark as uncleared" : "Mark as cleared";
  const glyph = reconciled
    ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 7V5a3 3 0 0 1 6 0v2"/><rect x="3.5" y="7" width="9" height="7" rx="1.5"/><path d="m6.5 10 1 1 2-2"/></svg>
    : <svg className={`transaction-status-circle ${state}`} viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="13.5" />
        <path d="M20 12.2a5.5 5.5 0 1 0 0 7.6" />
      </svg>;
  if (reconciled || !onToggle) return <span className={`transaction-status-icon ${reconciled ? "reconciled" : state}`} title={label} aria-label={label}>{glyph}</span>;
  return <button type="button" className={`transaction-status-icon ${state}`} title={label} aria-label={label} disabled={disabled} onClick={onToggle}>{glyph}</button>;
}
