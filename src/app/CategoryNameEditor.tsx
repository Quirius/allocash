import { useEffect, useRef, useState, type FormEvent } from "react";

export function CategoryNameEditor({ categoryId, name, busy, onRename }: { categoryId: string; name: string; busy: boolean; onRename: (id: string, name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const restoreFocus = useRef(false);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  useEffect(() => { if (!editing && !busy && restoreFocus.current) { button.current?.focus(); restoreFocus.current = false; } }, [editing, busy]);
  function close() { restoreFocus.current = true; setEditing(false); setError(null); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || lock.current) return;
    const next = draft.trim();
    if (!next || Array.from(next).length > 200) { setError("Enter a category name of 1 to 200 characters."); input.current?.focus(); return; }
    if (next === name) { close(); return; }
    lock.current = true; setSaving(true); setError(null);
    try { await onRename(categoryId, next); close(); }
    catch { setError("Could not rename this category. Your name is still here; try again."); }
    finally { lock.current = false; setSaving(false); }
  }
  return <div className="category-name-editor">
    {!editing ? <button ref={button} type="button" disabled={busy} aria-label={`Rename ${name}`} onClick={() => { setDraft(name); setError(null); setEditing(true); }}>Rename</button> :
      <form onSubmit={save} aria-label="Rename category" onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.preventDefault(); event.stopPropagation(); close(); } }}>
        <label>Category name<input ref={input} value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)} /></label>
        {error && <p className="editor-error" role="alert">{error}</p>}
        <div><button type="button" disabled={saving} onClick={close}>Cancel</button><button disabled={busy || saving || !draft.trim()}>{saving ? "Saving…" : "Save"}</button></div>
      </form>}
  </div>;
}
