"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string; detail?: string };
export function SettingMenu({
  label,
  value,
  options,
  onChange,
  disabled,
  icon,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected =
    options.find((option) => option.value === value) || options[0];
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <div
      className="setting-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="setting-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        <span>{selected?.label}</span>
        <ChevronDown size={13} className={open ? "chevron-open" : ""} />
      </button>
      {open && (
        <div
          className="setting-options"
          role="listbox"
          aria-label={label}
          id={id}
          onKeyDown={(event) => {
            const nodes = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="option"]',
              ),
            );
            const index = nodes.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? nodes.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        nodes.length) %
                      nodes.length;
              nodes[next]?.focus();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <div className="setting-heading">{label}</div>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={option.value === value ? 0 : -1}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <span>
                <span>{option.label}</span>
                {option.detail && <small>{option.detail}</small>}
              </span>
              {option.value === value && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
