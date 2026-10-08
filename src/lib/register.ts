import type { RegisterEntry } from "./desktop";

export function partitionRegisterEntries(entries: RegisterEntry[], today: string) {
  const upcoming = entries
    .filter((entry) => entry.postingState === "scheduled" || entry.date > today)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
  const history = entries.filter((entry) => entry.postingState !== "scheduled" && entry.date <= today);
  return { upcoming, history };
}
