import { describe, expect, it } from "vitest";
import { editCategoryNote, finishCategoryNoteSave, markCategoryNoteSaving, reconcileCategoryNoteDrafts, type CategoryNoteDrafts } from "../src/app/category-notes";

describe("category note draft lifecycle", () => {
  it("retains a saved draft until its exact text is observed, including clearing", () => {
    let drafts = editCategoryNote({}, "food", "");
    drafts = finishCategoryNoteSave(drafts, "food", "", true);
    expect(reconcileCategoryNoteDrafts(drafts, { food: "old note" })).toEqual(drafts);
    expect(reconcileCategoryNoteDrafts(drafts, { food: "" })).toEqual({});
  });
  it("preserves exact Unicode and newline text under its category across selection changes", () => {
    const text = "áprilisi cél 🧭\nsecond line\n";
    const drafts = editCategoryNote({}, "food", text);
    expect(drafts.food).toEqual({ value: text, status: "dirty" });
    expect(drafts).toHaveProperty("food");
  });

  it("does not let an older save completion replace a newer edit", () => {
    let drafts: CategoryNoteDrafts = editCategoryNote({}, "food", "first\nvalue");
    drafts = markCategoryNoteSaving(drafts, "food", "first\nvalue");
    drafts = editCategoryNote(drafts, "food", "newer 🥕");
    drafts = finishCategoryNoteSave(drafts, "food", "first\nvalue", false);
    expect(drafts.food).toEqual({ value: "newer 🥕", status: "dirty" });
  });

  it("keeps failed and unsaved drafts through refreshes, then clears saved drafts", () => {
    let drafts: CategoryNoteDrafts = editCategoryNote({}, "food", "needs retry");
    drafts = finishCategoryNoteSave(drafts, "food", "needs retry", false);
    drafts = editCategoryNote(drafts, "home", "not blurred yet");
    drafts = editCategoryNote(drafts, "other", "will save");
    drafts = markCategoryNoteSaving(drafts, "other", "will save");
    drafts = finishCategoryNoteSave(drafts, "other", "will save", true);
    expect(reconcileCategoryNoteDrafts(drafts, { food: "old", home: "old", other: "will save" })).toEqual({
      food: { value: "needs retry", status: "error" },
      home: { value: "not blurred yet", status: "dirty" },
    });
  });
});
