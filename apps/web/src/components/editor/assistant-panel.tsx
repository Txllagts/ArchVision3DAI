"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleAlert,
  Eraser,
  GraduationCap,
  Info,
  ListChecks,
  MessageSquare,
  Send,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import {
  reviewScene,
  tutorialProgress,
  type Diagnostic,
  type ProposedAction,
} from "@archvision/assistant";
import { useEditorStore } from "@/lib/editor/store";
import { useAssistant } from "@/lib/editor/use-assistant";
import { cn } from "@/lib/utils";

/**
 * Panel del asistente.
 *
 * Tres pestanas que responden a tres preguntas distintas: que quiero hacer
 * (conversacion), que esta mal (revision) y como se hace esto (tutorial). Se
 * separan porque se consultan en momentos distintos del trabajo, y mezclarlas
 * obligaria a desplazarse por lo que no interesa ahora.
 *
 * La revision y el tutorial se calculan en el navegador a partir de la escena
 * en memoria: son funciones puras, asi que se actualizan solas con cada
 * cambio y reflejan tambien lo que aun no se ha guardado.
 */

type Tab = "chat" | "review" | "tutorial";

const TABS: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Asistente", icon: MessageSquare },
  { id: "review", label: "Revision", icon: ListChecks },
  { id: "tutorial", label: "Tutorial", icon: GraduationCap },
];

const SEVERITY_STYLE: Record<
  Diagnostic["severity"],
  { icon: typeof Info; className: string; label: string }
> = {
  error: { icon: CircleAlert, className: "text-danger", label: "Problema" },
  warning: { icon: AlertTriangle, className: "text-warn", label: "Aviso" },
  info: { icon: Info, className: "text-accent", label: "Sugerencia" },
};

function ActionCard({
  action,
  onApply,
  onDismiss,
}: {
  action: ProposedAction;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <article className="rounded-md border border-accent/40 bg-accent/5 p-2">
      <header className="flex items-start gap-2">
        <Wand2 className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[11px] font-semibold text-ink">
            {action.title}
          </h4>
          <p className="text-[10px] leading-relaxed text-ink-muted">
            {action.summary}
          </p>
        </div>
      </header>

      {action.confidence < 0.7 ? (
        <p className="mt-1 text-[10px] text-ink-subtle">
          Revisa la propuesta antes de aplicarla: he tenido que suponer alguna
          cosa.
        </p>
      ) : null}

      <footer className="mt-2 flex gap-1">
        <button
          type="button"
          onClick={onApply}
          className="flex-1 rounded bg-accent px-2 py-1 text-[11px] font-medium text-accent-ink hover:opacity-90"
        >
          Aplicar
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-line-strong px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2"
        >
          Descartar
        </button>
      </footer>
    </article>
  );
}

function DiagnosticCard({ finding }: { finding: Diagnostic }) {
  const select = useEditorStore((state) => state.select);
  const dispatchBatch = useEditorStore((state) => state.dispatchBatch);
  const style = SEVERITY_STYLE[finding.severity];
  const Icon = style.icon;

  return (
    <article className="border-b border-line px-3 py-2 last:border-b-0">
      <header className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", style.className)} aria-hidden />
        <h4 className="flex-1 text-[11px] font-semibold text-ink">{finding.title}</h4>
      </header>

      <p className="mt-1 pl-5 text-[10px] leading-relaxed text-ink-muted">
        {finding.detail}
      </p>

      <div className="mt-1.5 flex gap-1 pl-5">
        {finding.entityIds.length > 0 ? (
          <button
            type="button"
            onClick={() => select(finding.entityIds)}
            className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            Seleccionar ({finding.entityIds.length})
          </button>
        ) : null}

        {finding.fix ? (
          <button
            type="button"
            onClick={() => dispatchBatch(finding.fix?.commands ?? [])}
            className="rounded border border-accent/50 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
          >
            {finding.fix.label}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ReviewTab() {
  const scene = useEditorStore((state) => state.scene);
  const findings = useMemo(() => reviewScene(scene), [scene]);

  if (findings.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-[11px] text-ink-subtle">
        No encuentro nada que corregir.
      </p>
    );
  }

  return (
    <div>
      <p className="border-b border-line px-3 py-2 text-[10px] text-ink-subtle">
        Se actualiza con cada cambio. Son criterios de uso corriente en
        vivienda, no una norma: verifica lo que vaya a construirse.
      </p>
      {findings.map((finding, index) => (
        <DiagnosticCard key={`${finding.rule}-${index}`} finding={finding} />
      ))}
    </div>
  );
}

function TutorialTab() {
  const scene = useEditorStore((state) => state.scene);
  const lessons = useMemo(() => tutorialProgress(scene), [scene]);

  return (
    <div className="space-y-3 px-3 py-2">
      <p className="text-[10px] leading-relaxed text-ink-subtle">
        Los pasos se marcan solos cuando el modelo demuestra que los hiciste.
        Puedes empezar por donde quieras.
      </p>

      {lessons.map((lesson) => (
        <section key={lesson.lessonId}>
          <header className="flex items-baseline justify-between gap-2">
            <h3 className="text-[11px] font-semibold text-ink">{lesson.title}</h3>
            <span
              className={cn(
                "shrink-0 text-[10px]",
                lesson.done === lesson.total ? "text-accent" : "text-ink-subtle",
              )}
            >
              {lesson.done}/{lesson.total}
            </span>
          </header>
          <p className="pb-1 text-[10px] text-ink-subtle">{lesson.summary}</p>

          <ol className="space-y-1">
            {lesson.steps.map((step) => (
              <li
                key={step.id}
                className={cn(
                  "rounded border px-2 py-1.5",
                  step.done
                    ? "border-line bg-surface-2/40"
                    : step.id === lesson.nextStepId
                      ? "border-accent/50 bg-accent/5"
                      : "border-line",
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-sm border",
                      step.done
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-line-strong",
                    )}
                  >
                    {step.done ? <Check className="size-2.5" aria-hidden /> : null}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-[11px]",
                        step.done ? "text-ink-subtle line-through" : "text-ink",
                      )}
                    >
                      {step.title}
                    </p>
                    {!step.done ? (
                      <>
                        <p className="text-[10px] leading-relaxed text-ink-muted">
                          {step.instruction}
                        </p>
                        {step.why ? (
                          <p className="mt-0.5 text-[10px] leading-relaxed text-ink-subtle">
                            {step.why}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function AssistantPanel({ onSave }: { onSave: () => Promise<boolean> | void }) {
  const open = useEditorStore((state) => state.assistantOpen);
  const setOpen = useEditorStore((state) => state.setAssistantOpen);

  const assistant = useAssistant({ onSave });
  const [tab, setTab] = useState<Tab>("chat");
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const { start, messages, busy, actions } = assistant;

  useEffect(() => {
    if (open) start();
  }, [open, start]);

  // El ultimo mensaje debe quedar a la vista sin arrastrar la barra.
  useEffect(() => {
    if (tab !== "chat") return;
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, actions, busy, tab]);

  if (!open) return null;

  const submit = () => {
    const text = draft;
    setDraft("");
    void assistant.send(text);
  };

  return (
    <aside className="absolute bottom-4 right-4 top-4 z-30 flex w-96 flex-col rounded-panel border border-line bg-surface/95 shadow-xl backdrop-blur">
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Sparkles className="size-3.5 text-accent" aria-hidden />
          Asistente
        </h2>
        <div className="flex items-center gap-1">
          {tab === "chat" && messages.length > 0 ? (
            <button
              type="button"
              aria-label="Borrar la conversacion"
              title="Borrar la conversacion"
              onClick={assistant.reset}
              className="text-ink-subtle hover:text-ink"
            >
              <Eraser className="size-3.5" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Cerrar el asistente"
            onClick={() => setOpen(false)}
            className="text-ink-subtle hover:text-ink"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </header>

      <nav className="flex border-b border-line" aria-label="Secciones del asistente">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 py-1.5 text-[10px]",
                tab === item.id
                  ? "border-b-2 border-accent text-accent"
                  : "text-ink-subtle hover:text-ink",
              )}
            >
              <Icon className="size-3" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto" ref={logRef}>
        {tab === "review" ? <ReviewTab /> : null}
        {tab === "tutorial" ? <TutorialTab /> : null}

        {tab === "chat" ? (
          <div className="space-y-2 px-3 py-2">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "whitespace-pre-wrap rounded-md px-2 py-1.5 text-[11px] leading-relaxed",
                  message.role === "user"
                    ? "ml-6 bg-surface-2 text-ink"
                    : "mr-2 text-ink-muted",
                )}
              >
                {message.text}
              </div>
            ))}

            {actions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                onApply={() => assistant.applyAction(action)}
                onDismiss={() => assistant.dismissAction(action.id)}
              />
            ))}

            {busy ? (
              <p className="px-2 text-[11px] text-ink-subtle">Pensando...</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {tab === "chat" ? (
        <footer className="border-t border-line px-3 py-2">
          {assistant.followUps.length > 0 && !busy ? (
            <div className="flex flex-wrap gap-1 pb-2">
              {assistant.followUps.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void assistant.send(suggestion)}
                  className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-muted hover:border-accent hover:text-accent"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-1">
            <textarea
              value={draft}
              rows={2}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter envia; Shift+Enter escribe otra linea.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="Pide un cambio o pregunta como se hace algo"
              aria-label="Mensaje para el asistente"
              className="min-h-0 flex-1 resize-none rounded border border-line bg-canvas px-2 py-1 text-[11px] text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || draft.trim().length === 0}
              aria-label="Enviar"
              className="grid size-7 shrink-0 place-items-center rounded bg-accent text-accent-ink disabled:opacity-40"
            >
              <Send className="size-3.5" aria-hidden />
            </button>
          </div>

          <p className="pt-1 text-[10px] text-ink-subtle">
            Nada se aplica sin que lo apruebes. Todo se deshace con Ctrl+Z.
          </p>
        </footer>
      ) : null}
    </aside>
  );
}
