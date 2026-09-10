// Money stays bigint in the frontend and signed integer HUF in SQLite/Rust.
// Serialize it as a decimal string across IPC to avoid JSON number precision loss.
export function formatHuf(amount: bigint): string {
  const sign = amount < 0n ? "−" : "";
  const digits = (amount < 0n ? -amount : amount).toString();
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ")} Ft`;
}

// Calendar dates are timezone-free ISO strings, never UTC timestamps.
export function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Expected an ISO calendar date (yyyy-mm-dd).");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) {
    throw new Error("Invalid calendar date.");
  }
  return `${match[1]}.${match[2]}.${match[3]}.`;
}
