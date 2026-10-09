import { expect, it } from "vitest";
import { createRequestSequence } from "../src/lib/request-sequence";

it("accepts only the newest overlapping request and invalidates reads across undo", () => {
  const sequence = createRequestSequence();
  const beforeUndo = sequence.begin();
  expect(sequence.isCurrent(beforeUndo)).toBe(true);

  sequence.invalidate();
  expect(sequence.isCurrent(beforeUndo)).toBe(false);
  const afterUndo = sequence.begin();
  const newerMonthOrReport = sequence.begin();
  expect(sequence.isCurrent(afterUndo)).toBe(false);
  expect(sequence.isCurrent(newerMonthOrReport)).toBe(true);
});
it("invalidates a request when its view is cleaned up", () => {
  const sequence = createRequestSequence();
  const request = sequence.begin();
  sequence.invalidate();
  expect(sequence.isCurrent(request)).toBe(false);
});
