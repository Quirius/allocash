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

export function localCalendarDate(value = new Date()): string {
  const year = value.getFullYear().toString().padStart(4, "0");
  const month = (value.getMonth() + 1).toString().padStart(2, "0");
  const day = value.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseHufInput(value: string): bigint {
  const trimmed = value.trim();
  const number = trimmed.endsWith("Ft") ? trimmed.slice(0, -2).trim() : trimmed;
  const groups = number.split(" ");
  const groupedCorrectly = groups.length === 1
    ? /^\d+$/.test(groups[0] ?? "")
    : /^\d{1,3}$/.test(groups[0] ?? "") && groups.slice(1).every((group) => /^\d{3}$/.test(group));
  if (!groupedCorrectly) {
    throw new Error("Enter a whole HUF amount, for example 12 500.");
  }
  const amount = BigInt(number.replaceAll(" ", ""));
  if (amount <= 0n || amount > 9223372036854775807n) {
    throw new Error("The amount must be between 1 Ft and the supported HUF maximum.");
  }
  return amount;
}

export function parseSignedHufInput(value: string): bigint {
  const trimmed = value.trim();
  const number = trimmed.endsWith("Ft") ? trimmed.slice(0, -2).trim() : trimmed;
  const negative = number.startsWith("-");
  const digits = negative ? number.slice(1) : number;
  const groups = digits.split(" ");
  const groupedCorrectly = groups.length === 1
    ? /^\d+$/.test(groups[0] ?? "")
    : /^\d{1,3}$/.test(groups[0] ?? "") && groups.slice(1).every((group) => /^\d{3}$/.test(group));
  if (!groupedCorrectly) throw new Error("Enter a whole signed HUF amount, for example -12 500.");
  const magnitude = BigInt(digits.replaceAll(" ", ""));
  const limit = negative ? 9223372036854775808n : 9223372036854775807n;
  if (magnitude > limit) throw new Error("The amount exceeds the supported HUF range.");
  return negative ? -magnitude : magnitude;
}
