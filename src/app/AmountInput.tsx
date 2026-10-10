import { forwardRef, useCallback, useRef, type ChangeEvent, type FocusEvent, type InputHTMLAttributes, type KeyboardEvent, type MouseEvent } from "react";
import { parseAmountExpression } from "../lib/amount-expression";

export type AmountInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value"> & { value: string | number };

function dispatchValue(input: HTMLInputElement, value: string) {
  if (input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { value, inputMode = "numeric", onFocus, onClick, onKeyDown, onBlur, ...props }, forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const initialValue = useRef(String(value));
  const setRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const selectAll = () => {
    const input = inputRef.current;
    if (input && !input.disabled && document.activeElement === input) input.select();
  };
  const handleFocus = (event: FocusEvent<HTMLInputElement>) => { initialValue.current = event.currentTarget.value; onFocus?.(event); selectAll(); };
  const handleClick = (event: MouseEvent<HTMLInputElement>) => { onClick?.(event); selectAll(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const input = event.currentTarget;
    if (input.disabled || input.readOnly) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dispatchValue(input, initialValue.current);
      input.blur();
      return;
    }
    if (event.key === "Enter") { input.blur(); return; }
    if (!["+", "-", "*", "/"].includes(event.key)) return;
    if (input.disabled || input.readOnly || input.selectionStart !== 0 || input.selectionEnd !== input.value.length || !input.value.trim()) return;
    let base: bigint;
    try { base = parseAmountExpression(input.value); } catch {
      // Outflow magnitudes can represent the signed HUF minimum's absolute value.
      try { base = -parseAmountExpression(`-(${input.value.trim().replace(/\s*Ft$/i, "")})`); } catch { return; }
    }
    event.preventDefault();
    const next = `${base.toString()}${event.key}`;
    dispatchValue(input, next);
    input.setSelectionRange(next.length, next.length);
  };
  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (!input.disabled && !input.readOnly && input.value.trim()) {
      try { dispatchValue(input, parseAmountExpression(input.value).toString()); } catch { /* Preserve invalid input for the parent's validation. */ }
    }
    onBlur?.(event);
  };

  return <input {...props} ref={setRef} value={value} inputMode={inputMode} onFocus={handleFocus} onClick={handleClick} onKeyDown={handleKeyDown} onBlur={handleBlur} />;
});

export type AmountInputChangeEvent = ChangeEvent<HTMLInputElement>;
