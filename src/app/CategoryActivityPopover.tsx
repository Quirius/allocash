import { useEffect, useRef, useState } from "react";
import { loadCategoryActivity, type CategoryActivity } from "../lib/desktop";
import { formatHuf } from "../lib/format";

type Props = {
  categoryId: string;
  categoryName: string;
  month: string;
  asOf: string;
  anchor: HTMLButtonElement;
  onClose: () => void;
};

type Position = { left: number; top: number; above: boolean };

export function CategoryActivityPopover({ categoryId, categoryName, month, asOf, anchor, onClose }: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const [position, setPosition] = useState<Position>({ left: 8, top: 8, above: false });
  const [activity, setActivity] = useState<CategoryActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function read() {
    const request = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const result = await loadCategoryActivity(categoryId, month, asOf);
      if (request !== generation.current) return;
      if (!result || result.categoryId !== categoryId || result.month !== month) throw new Error("Activity read did not match the selected category and month.");
      const rowTotal = result.rows.reduce((sum, row) => sum + BigInt(row.amount), 0n);
      if (rowTotal !== BigInt(result.total)) throw new Error("Activity rows did not reconcile to the category total.");
      setActivity(result);
      setLoading(false);
    } catch {
      if (request !== generation.current) return;
      setLoading(false);
      setError(true);
    }
  }

  useEffect(() => {
    void read();
    closeRef.current?.focus({ preventScroll: true });
    return () => { generation.current++; };
  }, [categoryId, month, asOf]);

  useEffect(() => {
    const reposition = () => {
      if (!anchor.isConnected) { onClose(); return; }
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(popupRef.current?.offsetWidth ?? 760, window.innerWidth - 16);
      const height = Math.min(popupRef.current?.offsetHeight ?? 400, window.innerHeight - 16);
      const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
      const below = rect.bottom + height + 8 <= window.innerHeight - 8;
      const desiredTop = below ? rect.bottom + 8 : rect.top - height - 8;
      const top = Math.max(8, Math.min(desiredTop, window.innerHeight - height - 8));
      setPosition({ left, top, above: !below });
    };
    const dismissOutside = (event: PointerEvent) => {
      if (!popupRef.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) close(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
    };
    function close(restoreFocus = true) {
      onClose();
      if (restoreFocus) requestAnimationFrame(() => anchor.isConnected && anchor.focus({ preventScroll: true }));
    }
    reposition();
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    if (observer && popupRef.current) observer.observe(popupRef.current);
    return () => {
      observer?.disconnect();
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchor, onClose]);

  function closeAndRestore() {
    onClose();
    requestAnimationFrame(() => anchor.isConnected && anchor.focus({ preventScroll: true }));
  }

  return <div ref={popupRef} className="plan-activity-popover" role="dialog" aria-modal="false" aria-label={`${categoryName} activity`} style={{ left: position.left, top: position.top }}>
    <header className="plan-activity-heading"><div><h2>Activity</h2><p>{categoryName} | {month}</p></div></header>
    <div className="plan-activity-content">
      {loading ? <p className="plan-activity-status" role="status">Loading activity...</p> : error ? <div className="plan-activity-status" role="alert"><p>Could not load activity for this category.</p><button type="button" onClick={() => void read()}>Retry</button></div> : !activity?.rows.length ? <p className="plan-activity-status" role="status">No activity this month.</p> : <div className="plan-activity-table-scroll" role="region" aria-label={`${categoryName} activity transactions`} tabIndex={0}><table><thead><tr><th scope="col">Account</th><th scope="col">Date</th><th scope="col">Payee</th><th scope="col">Memo</th><th scope="col">Amount</th></tr></thead><tbody>{[...activity.rows].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).map((row) => <tr key={`${row.kind ?? "ledger"}:${row.id}`}><td>{row.accountName}</td><td>{row.date || "\u2014"}</td><td>{row.payeeName}</td><td>{row.memo}</td><td className="plan-activity-amount">{formatHuf(BigInt(row.amount))}</td></tr>)}</tbody></table></div>}
    </div>
    <footer className="plan-activity-footer"><button ref={closeRef} type="button" onClick={closeAndRestore}>Close</button></footer>
  </div>;
}
