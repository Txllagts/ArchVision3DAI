"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Item {
  q: string;
  a: string;
}

/**
 * Preguntas frecuentes con apertura animada.
 *
 * La altura se anima con grid-template-rows (0fr -> 1fr), sin medir en JS.
 * El icono + gira a x, y el borde de la pregunta abierta se enciende en
 * Survey Sky. Varias preguntas pueden estar abiertas a la vez.
 */
export function FaqAccordion({ items }: { items: Item[] }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const baseId = useId();

  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const isOpen = open.has(index);
        const buttonId = `${baseId}-q-${index}`;
        const panelId = `${baseId}-a-${index}`;
        return (
          <div
            key={item.q}
            className={cn(
              "rounded-panel border bg-surface transition-[border-color,background-color,box-shadow] duration-300",
              isOpen
                ? "border-accent/60 bg-surface-2/60 shadow-[0_12px_32px_-16px_rgb(46_167_242/0.35)]"
                : "border-line hover:border-line-strong",
            )}
          >
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(index)}
                className="group flex w-full items-center justify-between gap-4 rounded-panel px-5 py-4 text-left text-[0.9375rem] font-medium text-ink"
              >
                <span className="transition-colors duration-200 group-hover:text-accent">
                  {item.q}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border transition-[transform,background-color,border-color,color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
                    isOpen
                      ? "rotate-45 border-accent bg-accent text-accent-ink"
                      : "border-line-strong text-ink-muted group-hover:border-accent group-hover:text-accent",
                  )}
                >
                  <Plus className="size-3.5" strokeWidth={2} />
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className="accordion-body"
              data-open={isOpen}
              inert={!isOpen}
            >
              <div>
                <p className="px-5 pb-5 text-sm leading-relaxed text-ink-muted">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
