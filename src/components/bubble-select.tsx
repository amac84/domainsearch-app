"use client";

import { cn } from "@/lib/utils";

export interface BubbleOption {
  value: string;
  label: string;
  /** Optional tooltip shown on hover/focus; explains what the option means. */
  description?: string;
}

interface BubbleSelectProps {
  options: readonly BubbleOption[];
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  title?: string;
  className?: string;
  /** If true, at least one option must stay selected (user can't clear all). */
  minSelection?: number;
}

export function BubbleSelect({
  options,
  value,
  onChange,
  label,
  title,
  className,
  minSelection = 0,
}: BubbleSelectProps) {
  const selectedSet = new Set(value);

  function toggle(optionValue: string) {
    const next = new Set(selectedSet);
    if (next.has(optionValue)) {
      if (minSelection > 0 && next.size <= minSelection) return;
      next.delete(optionValue);
    } else {
      next.add(optionValue);
    }
    onChange(Array.from(next));
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} title={title}>
      {label ? (
        <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const isSelected = selectedSet.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              title={opt.description ? `${opt.label} — ${opt.description}` : opt.label}
              aria-label={opt.description ? `${opt.label}: ${opt.description}` : opt.label}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isSelected
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
