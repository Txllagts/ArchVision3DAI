"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  PRICING,
  formatMoney,
  planLimits,
  priceFor,
  yearlySavingCents,
  type BillingInterval,
  type PlanId,
} from "@archvision/config";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Tabla de planes.
 *
 * Se usa en la landing y en la pantalla de facturacion. Es la misma tabla a
 * proposito: el precio que se promete antes de registrarse y el que se cobra
 * despues salen del mismo catalogo, y no pueden discrepar.
 *
 * El ciclo anual se muestra con el ahorro en pesos, no en porcentaje: "dos
 * meses gratis" se entiende sin hacer cuentas.
 */

const ORDER: PlanId[] = ["free", "pro", "studio", "enterprise"];

interface Props {
  /** Plan que rige ahora mismo, para marcarlo y no ofrecer contratarlo. */
  currentPlan?: PlanId;
  /** Ausente en la landing: alli el boton lleva al registro. */
  onSelect?: (plan: PlanId, interval: BillingInterval) => Promise<void> | void;
  /** false cuando no hay pasarela: se explica en vez de fallar al pulsar. */
  checkoutAvailable?: boolean;
  registerHref?: string;
}

export function PlanCards({
  currentPlan,
  onSelect,
  checkoutAvailable = true,
  registerHref = "/register",
}: Props) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [busy, setBusy] = useState<PlanId | null>(null);

  return (
    <div>
      <div className="flex items-center justify-center gap-3 pb-8">
        <div className="relative grid grid-cols-2 rounded-full border border-line bg-surface p-1">
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-accent-fill transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              interval === "year" && "translate-x-full",
            )}
          />
          {(["month", "year"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setInterval(option)}
              aria-pressed={interval === option}
              className={cn(
                "relative z-10 w-24 rounded-full py-1.5 text-xs font-medium transition-colors duration-300",
                interval === option
                  ? "text-accent-fill-ink"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {option === "month" ? "Mensual" : "Anual"}
            </button>
          ))}
        </div>
        <span
          className={cn(
            "text-xs text-accent transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            interval === "year" ? "opacity-100" : "-translate-x-2 opacity-0",
          )}
          aria-hidden={interval !== "year"}
        >
          Dos meses gratis en cada plan
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ORDER.map((planId) => {
          const pricing = PRICING[planId];
          const limits = planLimits(planId);
          const price = priceFor(planId, interval);
          const saving = interval === "year" ? yearlySavingCents(planId) : 0;
          const isCurrent = currentPlan === planId;
          const purchasable = Boolean(price && price.amountCents > 0);

          return (
            <article
              key={planId}
              className={cn(
                "flex h-full flex-col rounded-panel border bg-surface p-5",
                "transition-[transform,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 motion-reduce:hover:translate-y-0",
                pricing.featured
                  ? "border-accent shadow-[0_16px_40px_-20px_rgb(46_167_242/0.45)] hover:shadow-[0_24px_56px_-20px_rgb(46_167_242/0.55)]"
                  : "border-line hover:border-line-strong",
              )}
            >
              <header>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">{limits.label}</h3>
                  {isCurrent ? (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">
                      Tu plan
                    </span>
                  ) : pricing.featured ? (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">
                      Recomendado
                    </span>
                  ) : null}
                </div>

                <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
                  {pricing.tagline}
                </p>

                <div className="mt-4">
                  {pricing.contactOnly ? (
                    <p className="text-lg font-semibold text-ink">A convenir</p>
                  ) : (
                    <div key={interval} className="av-swap">
                      <p className="text-2xl font-semibold tracking-tight text-ink">
                        {formatMoney(price?.amountCents ?? 0, pricing.currency)}
                      </p>
                      <p className="text-[11px] text-ink-subtle">
                        {price?.amountCents === 0
                          ? "Para siempre"
                          : interval === "year"
                            ? "al ano, IVA incluido"
                            : "al mes, IVA incluido"}
                      </p>
                      {saving > 0 ? (
                        <p className="mt-0.5 text-[11px] text-accent">
                          Ahorras {formatMoney(saving, pricing.currency)}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </header>

              <ul className="mt-4 flex-1 space-y-1.5 text-[11px] text-ink-muted">
                {pricing.highlights.map((item) => (
                  <li key={item} className="flex gap-1.5">
                    <Check className="mt-0.5 size-3 shrink-0 text-accent" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <footer className="mt-5">
                {pricing.contactOnly ? (
                  <a href="mailto:ventas@archvision.app">
                    <Button variant="outline" className="w-full justify-center">
                      Hablar con ventas
                    </Button>
                  </a>
                ) : !onSelect ? (
                  <a href={registerHref}>
                    <Button
                      variant={pricing.featured ? "primary" : "outline"}
                      className="w-full justify-center"
                    >
                      {purchasable ? "Empezar" : "Crear cuenta"}
                    </Button>
                  </a>
                ) : isCurrent ? (
                  <Button variant="outline" className="w-full justify-center" disabled>
                    Plan actual
                  </Button>
                ) : !purchasable ? (
                  <Button variant="outline" className="w-full justify-center" disabled>
                    Incluido al registrarse
                  </Button>
                ) : (
                  <Button
                    variant={pricing.featured ? "primary" : "outline"}
                    className="w-full justify-center"
                    disabled={!checkoutAvailable || busy !== null}
                    onClick={async () => {
                      setBusy(planId);
                      try {
                        await onSelect(planId, interval);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === planId ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : null}
                    {currentPlan && currentPlan !== "free" ? "Cambiar a este" : "Contratar"}
                  </Button>
                )}
              </footer>
            </article>
          );
        })}
      </div>

      {onSelect && !checkoutAvailable ? (
        <p className="pt-4 text-center text-[11px] text-ink-subtle">
          El cobro no esta disponible ahora mismo: falta configurar la pasarela.
          Escribe a soporte y lo activamos.
        </p>
      ) : null}
    </div>
  );
}
