export interface UndoKeyboardEventLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
}

export function isUndoShortcutEligible(event: UndoKeyboardEventLike): boolean {
  if (event.key.toLowerCase() !== "z" || !event.ctrlKey || event.shiftKey || event.altKey || event.repeat) return false;
  const target = event.target;
  if (!target || typeof (target as Element).closest !== "function") return true;
  if ((target as Element).closest("input, textarea, [contenteditable]:not([contenteditable='false']), [role='textbox']")) return false;
  return true;
}
