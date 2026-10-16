import type { RegisterEntry } from "../lib/desktop";

export type RegisterDatePreset = "ThisMonth" | "LastMonth" | "Latest3Months" | "ThisYear" | "LastYear" | "AllDates" | "Custom";

export interface RegisterViewOptions {
  datePreset: RegisterDatePreset;
  customFromMonth: string;
  customToMonth: string;
  showReconciled: boolean;
  showFlags: boolean;
  showRunningBalance: boolean;
}

const initialMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

export const DEFAULT_REGISTER_VIEW_OPTIONS: RegisterViewOptions = {
  datePreset: "AllDates",
  customFromMonth: initialMonth,
  customToMonth: initialMonth,
  showReconciled: true,
  showFlags: true,
  showRunningBalance: false,
};

export interface RegisterDateRange {
  fromDate: string | null;
  toDate: string | null;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [yearText, monthText] = month.split("-");
  const index = Number(yearText) * 12 + Number(monthText) - 1 + delta;
  const year = Math.floor(index / 12);
  const monthIndex = ((index % 12) + 12) % 12;
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function monthStart(month: string): string { return `${month}-01`; }
function monthEnd(month: string): string {
  const next = shiftMonth(month, 1);
  const [year, monthNumber] = next.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, monthNumber! - 1, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

export function getRegisterDateRange(options: RegisterViewOptions, today: string): RegisterDateRange {
  const currentMonth = monthOf(today);
  let fromMonth: string;
  let toMonth: string;
  switch (options.datePreset) {
    case "AllDates": return { fromDate: null, toDate: null };
    case "Custom":
      fromMonth = options.customFromMonth || "0000-01";
      toMonth = options.customToMonth || "9999-12";
      break;
    case "ThisMonth": fromMonth = currentMonth; toMonth = currentMonth; break;
    case "LastMonth": fromMonth = shiftMonth(currentMonth, -1); toMonth = fromMonth; break;
    case "Latest3Months": fromMonth = shiftMonth(currentMonth, -2); toMonth = currentMonth; break;
    case "ThisYear": fromMonth = `${today.slice(0, 4)}-01`; toMonth = `${today.slice(0, 4)}-12`; break;
    case "LastYear": fromMonth = `${Number(today.slice(0, 4)) - 1}-01`; toMonth = `${Number(today.slice(0, 4)) - 1}-12`; break;
  }
  return { fromDate: monthStart(fromMonth), toDate: monthEnd(toMonth) };
}

export function filterRegisterEntries<T extends RegisterEntry>(entries: T[], options: RegisterViewOptions, today: string): T[] {
  const { fromDate, toDate } = getRegisterDateRange(options, today);
  if (fromDate && toDate && fromDate > toDate) return [];
  return entries.filter((entry) =>
    (options.showReconciled || entry.clearedState !== "reconciled") &&
    (!fromDate || entry.date >= fromDate) &&
    (!toDate || entry.date <= toDate),
  );
}

/** Computes ledger running balances across the complete register before view filters or pagination. */
export function getRegisterRunningBalances(entries: RegisterEntry[], today: string): Map<string, string | null> {
  const balances = new Map<string, string | null>();
  const eligible = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.postingState === "posted" && entry.date <= today)
    .sort((left, right) => left.entry.date.localeCompare(right.entry.date) || right.index - left.index);

  let balance = 0n;
  for (const { entry } of eligible) {
    balance += BigInt(entry.amount);
    balances.set(entry.id, balance.toString());
  }
  for (const entry of entries) {
    if (!balances.has(entry.id)) balances.set(entry.id, null);
  }
  return balances;
}
