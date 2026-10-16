import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { SearchFilter, SearchSuggestion } from "./register-search";

interface RegisterSearchProps {
  value: string;
  onChange: (value: string) => void;
  filter: SearchFilter;
  onSelect: (filter: SearchFilter) => void;
  suggestions: SearchSuggestion[];
  disabled: boolean;
  placeholder: string;
}

function selectedLabel(filter: SearchFilter): string | null {
  if (filter.kind === "any") return null;
  if ("label" in filter) {
    const field = filter.kind === "account" ? "Account" : filter.kind === "flag" ? "Flag" : "Category";
    return `${field}: ${filter.label}`;
  }
  const field = filter.kind === "payee" ? "Payee" : filter.kind === "category" ? "Category" : "Memo";
  return `${field}: ${filter.query}`;
}

export function RegisterSearch({ value, onChange, filter, onSelect, suggestions, disabled, placeholder }: RegisterSearchProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const touchInteraction = useRef(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const visible = focused && !dismissed && !disabled && value.trim().length > 0 && suggestions.length > 0;
  const label = selectedLabel(filter);

  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setFocused(false);
        setActive(-1);
      }
    };
    const finishTouch = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch") touchInteraction.current = false;
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("pointerup", finishTouch);
    document.addEventListener("pointercancel", finishTouch);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("pointerup", finishTouch);
      document.removeEventListener("pointercancel", finishTouch);
    };
  }, []);

  useEffect(() => {
    if (active >= 0) optionRefs.current[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const select = (suggestion: SearchSuggestion) => {
    onSelect(suggestion.filter);
    setActive(-1);
    setDismissed(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && visible) {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp" && visible) {
      event.preventDefault();
      setActive((current) => Math.max(current <= 0 ? suggestions.length - 1 : current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (visible && active >= 0) {
        const suggestion = suggestions[active];
        if (suggestion) select(suggestion);
      } else if (filter.kind === "any" && value.trim()) {
        onSelect({ kind: "any", query: value.trim() });
        setDismissed(true);
      } else {
        // Enter confirms the selected scope after the list has been dismissed.
        onSelect(filter);
      }
    } else if (event.key === "Escape" && visible) {
      event.preventDefault();
      setDismissed(true);
      setActive(-1);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Keep focus for mouse/pen clicks; touch needs its native behavior so the
    // list can still scroll before a tap selects an option.
    if (event.pointerType === "touch") touchInteraction.current = true;
    else event.preventDefault();
  };

  return <div className="all-register-search register-search" ref={root}>
    {label && <span className="register-search-filter" aria-label={`Selected filter ${label}`}>{label}</span>}
    <svg className="register-search-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="m12.5 12.5 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
    <input
      type="search"
      role="combobox"
      aria-label={placeholder}
      aria-autocomplete="list"
      aria-expanded={visible}
      aria-controls={`${id}-listbox`}
      aria-activedescendant={visible && active >= 0 ? `${id}-option-${active}` : undefined}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onBlur={() => { if (!touchInteraction.current) setFocused(false); }}
      onChange={(event) => { onChange(event.currentTarget.value); setDismissed(false); setActive(-1); }}
      onKeyDown={onKeyDown}
    />
    {value.length > 0 && <button type="button" className="register-search-clear" aria-label="Clear search" disabled={disabled} onClick={() => {
      onChange("");
      onSelect({ kind: "any", query: "" });
      setDismissed(false);
      setActive(-1);
    }}>×</button>}
    {visible && <div className="register-search-suggestions" id={`${id}-listbox`} role="listbox" aria-label="Search suggestions">
      {suggestions.map((suggestion, index) => <div
        key={suggestion.key}
        id={`${id}-option-${index}`}
        ref={(element) => { optionRefs.current[index] = element; }}
        className={`register-search-suggestion${active === index ? " active" : ""}`}
        role="option"
        aria-selected={active === index}
        onPointerDown={onPointerDown}
        onClick={() => select(suggestion)}
      >
        {suggestion.color && <span className="register-search-suggestion-color" style={{ backgroundColor: suggestion.color }} aria-hidden="true" />}
        <span className="register-search-suggestion-field">{suggestion.fieldLabel}</span>
        <span className="register-search-suggestion-label">{suggestion.label}</span>
      </div>)}
    </div>}
  </div>;
}
