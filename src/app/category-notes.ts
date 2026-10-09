export type CategoryNoteDraft = { value: string; status: "dirty" | "saving" | "saved" | "error" };
export type CategoryNoteDrafts = Record<string, CategoryNoteDraft>;

export function editCategoryNote(drafts: CategoryNoteDrafts, categoryId: string, value: string): CategoryNoteDrafts {
  return { ...drafts, [categoryId]: { value, status: "dirty" } };
}

export function markCategoryNoteSaving(drafts: CategoryNoteDrafts, categoryId: string, value: string): CategoryNoteDrafts {
  const current = drafts[categoryId];
  return current?.value === value ? { ...drafts, [categoryId]: { value, status: "saving" } } : drafts;
}

export function finishCategoryNoteSave(drafts: CategoryNoteDrafts, categoryId: string, value: string, success: boolean): CategoryNoteDrafts {
  const current = drafts[categoryId];
  return current?.value === value ? { ...drafts, [categoryId]: { value, status: success ? "saved" : "error" } } : drafts;
}

export function reconcileCategoryNoteDrafts(drafts: CategoryNoteDrafts, notesByCategory: Record<string, string>): CategoryNoteDrafts {
  const next = { ...drafts };
  for (const [categoryId, draft] of Object.entries(drafts)) {
    if (draft.status === "saved" && notesByCategory[categoryId] === draft.value) delete next[categoryId];
  }
  return next;
}
