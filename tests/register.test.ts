import { expect, it } from "vitest";
import type { RegisterEntry } from "../src/lib/desktop";
import { partitionRegisterEntries } from "../src/lib/register";

function entry(id: string, date: string, postingState: RegisterEntry["postingState"] = "posted"): RegisterEntry {
  return {
    id, date, payeeName: id, categoryId: null, categoryGroupName: null, categoryName: null,
    memo: "", flagId: null, flagName: null, flagColor: null, clearedState: "cleared",
    postingState, origin: "manual", amount: "100", transferId: null, transferAccountName: null,
  };
}

it("keeps all future rows together in date order, independent of history pagination", () => {
  const entries = [
    entry("later-history", "2026-10-04"),
    entry("scheduled-later", "2026-10-09", "scheduled"),
    entry("scheduled-today", "2026-10-05", "scheduled"),
    entry("scheduled-overdue", "2026-10-03", "scheduled"),
    entry("today", "2026-10-05"),
    entry("future-posted", "2026-10-07"),
    ...Array.from({ length: 101 }, (_, index) => entry(`history-${index}`, "2026-10-01")),
  ];

  const { upcoming, history } = partitionRegisterEntries(entries, "2026-10-05");

  expect(upcoming.map(({ id }) => id)).toEqual(["scheduled-overdue", "scheduled-today", "future-posted", "scheduled-later"]);
  expect(upcoming[2]?.postingState).toBe("posted");
  expect(history).toHaveLength(103);
  expect(history.some(({ id }) => id === "today")).toBe(true);
  expect(new Set([...upcoming, ...history].map(({ id }) => id)).size).toBe(entries.length);
});
