import { expect, it } from "vitest";
import { isUndoShortcutEligible } from "../src/lib/undo";

const event = (overrides: Partial<Parameters<typeof isUndoShortcutEligible>[0]> = {}) => ({
  key: "z", ctrlKey: true, shiftKey: false, altKey: false, repeat: false, target: null, ...overrides,
});

it("accepts Ctrl+Z outside native text editing", () => {
  expect(isUndoShortcutEligible(event())).toBe(true);
});

it.each([
  { key: "x" }, { ctrlKey: false }, { shiftKey: true }, { altKey: true }, { repeat: true },
])("ignores modified, repeated, or unrelated keys", (override) => {
  expect(isUndoShortcutEligible(event(override))).toBe(false);
});

it("preserves native text undo in inputs and editable content", () => {
  const input = { closest: (selector: string) => selector.includes("input") ? {} as Element : null } as unknown as Element;
  const editable = { closest: (selector: string) => selector.includes("contenteditable") ? {} as Element : null } as unknown as Element;
  expect(isUndoShortcutEligible(event({ target: input }))).toBe(false);
  expect(isUndoShortcutEligible(event({ target: editable }))).toBe(false);
});
