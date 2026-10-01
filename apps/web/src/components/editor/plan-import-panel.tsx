"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2, Upload, X } from "lucide-react";
import { detectWalls, detectWallsRemote } from "@archvision/vision";
import type { PlanUnderlay } from "@archvision/types";
import { useEditorStore, type ProposedWall } from "@/lib/editor/store";
import { imageToWorld, loadImageData, recalibrate } from "@/lib/editor/underlay";
import { cn } from "@/lib/utils";

/**
 * Importacion de planos.
 *
 * El recorrido es siempre el mismo y en este orden, porque cada paso necesita
 * el anterior: subir la imagen, decirle cuanto mide algo conocido (sin escala
 * no hay medidas reales) y solo entonces detectar muros o calcarlos a mano.
 *
 * La deteccion nunca escribe en el documento: propone, y el usuario acepta.
 */

interface ProjectFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  url: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PlanImportPanel() {
  const open = useEditorStore((state) => state.planPanelOpen);
  const setOpen = useEditorStore((state) => state.setPlanPanelOpen);
  const projectId = useEditorStore((state) => state.projectId);
  const underlay = useEditorStore((state) => state.scene.underlay ?? null);
  const dispatch = useEditorStore((state) => state.dispatch);
  const setMessage = useEditorStore((state) => state.setMessage);
  const setTool = useEditorStore((state) => state.setTool);
  const calibration = useEditorStore((state) => state.calibration);
  const setCalibration = useEditorStore((state) => state.setCalibration);
  const proposal = useEditorStore((state) => state.proposal);
  const setProposal = useEditorStore((state) => state.setProposal);
  const toggleProposal = useEditorStore((state) => state.toggleProposal);
  const applyProposal = useEditorStore((state) => state.applyProposal);

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [busy, setBusy] = useState<"upload" | "detect" | null>(null);
  const [realLength, setRealLength] = useState("5");
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const response = await fetch(`/api/projects/${projectId}/files?kind=floorplan`);
    if (!response.ok) return;
    const payload = (await response.json()) as { data?: { files?: ProjectFile[] } };
    setFiles(payload.data?.files ?? []);
  }, [projectId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const active = files.find((file) => file.id === underlay?.fileId) ?? null;

  const upload = async (file: File) => {
    setBusy("upload");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", "floorplan");

      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as {
        data?: { file?: ProjectFile };
        error?: { message?: string };
      };

      if (!response.ok || !payload.data?.file) {
        setMessage({
          kind: "error",
          text: payload.error?.message ?? "No se pudo subir el plano",
        });
        return;
      }

      const uploaded = payload.data.file;
      await refresh();

      if (uploaded.mimeType === "application/pdf") {
        setMessage({
          kind: "info",
          text: "PDF guardado. Por ahora solo se puede calcar desde imagen: exportalo a PNG.",
        });
        return;
      }

      if (!uploaded.width || !uploaded.height) {
        setMessage({ kind: "error", text: "No se pudieron leer las dimensiones" });
        return;
      }

      // Escala inicial arbitraria pero razonable: 50 px/m deja un plano
      // domestico a un tamano manejable hasta que el usuario calibre.
      const created: PlanUnderlay = {
        fileId: uploaded.id,
        pixelsPerMeter: 50,
        offset: { x: 0, y: 0 },
        rotationDeg: 0,
        opacity: 0.55,
        visible: true,
        width: uploaded.width,
        height: uploaded.height,
      };

      dispatch({ type: "SET_UNDERLAY", underlay: created });
      setMessage({
        kind: "info",
        text: "Plano colocado. Marca una medida conocida para fijar la escala.",
      });
    } finally {
      setBusy(null);
    }
  };

  const patch = (changes: Partial<PlanUnderlay>) => {
    if (!underlay) return;
    dispatch({ type: "SET_UNDERLAY", underlay: { ...underlay, ...changes } });
  };

  const applyCalibration = () => {
    if (!underlay || !calibration.start || !calibration.end) return;
    const meters = Number.parseFloat(realLength.replace(",", "."));

    try {
      const updated = recalibrate(underlay, calibration.start, calibration.end, meters);
      dispatch({ type: "SET_UNDERLAY", underlay: updated });
      setCalibration({ start: null, end: null });
      setMessage({
        kind: "info",
        text: `Escala fijada: ${updated.pixelsPerMeter.toFixed(1)} px/m`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Calibracion invalida",
      });
    }
  };

  const detect = async () => {
    if (!underlay || !active) return;
    setBusy("detect");

    try {
      let report;
      try {
        report = await detectWallsRemote(active.url, {
          pixelsPerMeter: underlay.pixelsPerMeter,
        });
      } catch {
        const image = await loadImageData(active.url);
        report = detectWalls(image, { pixelsPerMeter: underlay.pixelsPerMeter });
      }

      const proposed: ProposedWall[] = report.walls.map((wall) => {
        // La deteccion trabaja en metros medidos sobre la imagen; hay que
        // llevarlos al sistema del modelo con la misma colocacion del plano.
        const start = imageToWorld(underlay, {
          x: wall.start.x * underlay.pixelsPerMeter,
          y: wall.start.y * underlay.pixelsPerMeter,
        });
        const end = imageToWorld(underlay, {
          x: wall.end.x * underlay.pixelsPerMeter,
          y: wall.end.y * underlay.pixelsPerMeter,
        });

        return {
          start,
          end,
          thickness: wall.thickness,
          length: wall.length,
          confidence: wall.confidence,
          // Se marcan de entrada las fiables; las dudosas exigen un clic.
          accepted: wall.confidence >= 0.6,
        };
      });

      setProposal(proposed);
      setMessage(
        proposed.length > 0
          ? {
              kind: "info",
              text: `${proposed.length} muros propuestos. Revisa y acepta los que quieras.`,
            }
          : {
              kind: "error",
              text: "No se encontraron muros. Revisa la escala o sube un plano mas limpio.",
            },
      );
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Fallo la deteccion",
      });
    } finally {
      setBusy(null);
    }
  };

  const removeFile = async (fileId: string) => {
    await fetch(`/api/projects/${projectId}/files/${fileId}`, { method: "DELETE" });
    if (underlay?.fileId === fileId) {
      dispatch({ type: "SET_UNDERLAY", underlay: null });
      setProposal(null);
    }
    await refresh();
  };

  const acceptedCount = proposal?.filter((wall) => wall.accepted).length ?? 0;

  return (
    <div className="absolute right-4 top-4 z-20 flex max-h-[calc(100%-2rem)] w-80 flex-col overflow-y-auto rounded-panel border border-line bg-surface/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-xs font-semibold text-ink">Importar plano</h2>
        <button
          type="button"
          aria-label="Cerrar importacion de planos"
          onClick={() => setOpen(false)}
          className="text-ink-subtle hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="space-y-3 px-3 py-3">
        {/* Paso 1: archivo */}
        <section>
          <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            1. Archivo
          </h3>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-line-strong px-3 py-3 text-[11px] text-ink-muted hover:border-accent hover:text-ink disabled:opacity-50"
          >
            {busy === "upload" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-3.5" aria-hidden />
            )}
            Subir plano (PNG, JPG, WebP, PDF)
          </button>

          {files.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {files.map((file) => (
                <li
                  key={file.id}
                  className={cn(
                    "flex items-center gap-2 rounded border px-2 py-1 text-[11px]",
                    file.id === underlay?.fileId
                      ? "border-accent/50 bg-accent/10 text-ink"
                      : "border-line text-ink-muted",
                  )}
                >
                  <button
                    type="button"
                    className="flex-1 truncate text-left"
                    onClick={() => {
                      if (!file.width || !file.height) return;
                      dispatch({
                        type: "SET_UNDERLAY",
                        underlay: {
                          fileId: file.id,
                          pixelsPerMeter: underlay?.pixelsPerMeter ?? 50,
                          offset: underlay?.offset ?? { x: 0, y: 0 },
                          rotationDeg: underlay?.rotationDeg ?? 0,
                          opacity: underlay?.opacity ?? 0.55,
                          visible: true,
                          width: file.width,
                          height: file.height,
                        },
                      });
                    }}
                  >
                    {file.originalName}
                    <span className="ml-1 text-ink-subtle">{formatSize(file.sizeBytes)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Eliminar ${file.originalName}`}
                    onClick={() => void removeFile(file.id)}
                    className="text-ink-subtle hover:text-danger"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {underlay ? (
          <>
            {/* Paso 2: colocacion */}
            <section className="space-y-2 border-t border-line pt-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                2. Colocacion
              </h3>

              <label className="flex items-center gap-2 text-[11px] text-ink-muted">
                <input
                  type="checkbox"
                  checked={underlay.visible}
                  onChange={(event) => patch({ visible: event.target.checked })}
                />
                Mostrar en planta
              </label>

              <label className="block text-[11px] text-ink-muted">
                Opacidad {Math.round(underlay.opacity * 100)}%
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(underlay.opacity * 100)}
                  onChange={(event) => patch({ opacity: Number(event.target.value) / 100 })}
                  className="w-full"
                />
              </label>

              <label className="block text-[11px] text-ink-muted">
                Giro {underlay.rotationDeg.toFixed(1)}°
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={0.5}
                  value={underlay.rotationDeg}
                  onChange={(event) => patch({ rotationDeg: Number(event.target.value) })}
                  className="w-full"
                />
              </label>

              <p className="text-[10px] text-ink-subtle">
                Escala actual: {underlay.pixelsPerMeter.toFixed(1)} px/m ·{" "}
                {(underlay.width / underlay.pixelsPerMeter).toFixed(1)} ×{" "}
                {(underlay.height / underlay.pixelsPerMeter).toFixed(1)} m
              </p>
            </section>

            {/* Paso 3: escala */}
            <section className="space-y-2 border-t border-line pt-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                3. Escala
              </h3>
              <p className="text-[10px] leading-relaxed text-ink-subtle">
                Traza en la planta una linea sobre una medida que conozcas (una
                cota, una fachada) y escribe cuanto mide en la realidad.
              </p>

              <button
                type="button"
                onClick={() => {
                  setTool("calibrate");
                  setCalibration({ start: null, end: null });
                }}
                className="w-full rounded border border-line-strong px-2 py-1 text-[11px] text-ink hover:bg-surface-2"
              >
                Marcar medida en el plano
              </button>

              <div className="flex items-center gap-2">
                <input
                  value={realLength}
                  onChange={(event) => setRealLength(event.target.value)}
                  inputMode="decimal"
                  aria-label="Medida real en metros"
                  className="w-20 rounded border border-line bg-canvas px-2 py-1 text-[11px] text-ink outline-none focus:border-accent"
                />
                <span className="text-[11px] text-ink-subtle">m</span>
                <button
                  type="button"
                  disabled={!calibration.start || !calibration.end}
                  onClick={applyCalibration}
                  className="flex-1 rounded border border-line-strong px-2 py-1 text-[11px] text-ink enabled:hover:bg-surface-2 disabled:opacity-40"
                >
                  Aplicar escala
                </button>
              </div>
            </section>

            {/* Paso 4: deteccion */}
            <section className="space-y-2 border-t border-line pt-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                4. Detectar muros
              </h3>

              <button
                type="button"
                disabled={busy !== null || !active}
                onClick={() => void detect()}
                className="flex w-full items-center justify-center gap-2 rounded border border-line-strong px-2 py-1.5 text-[11px] text-ink enabled:hover:bg-surface-2 disabled:opacity-40"
              >
                {busy === "detect" ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                Analizar el plano
              </button>

              {proposal ? (
                <div className="space-y-1">
                  <p className="text-[10px] text-ink-subtle">
                    {acceptedCount} de {proposal.length} aceptados
                  </p>
                  <div className="max-h-40 space-y-0.5 overflow-y-auto">
                    {proposal.map((wall, index) => (
                      <button
                        key={`${wall.start.x},${wall.start.y},${wall.end.x},${wall.end.y}`}
                        type="button"
                        onClick={() => toggleProposal(index)}
                        className={cn(
                          "flex w-full items-center justify-between rounded px-1.5 py-0.5 text-[10px]",
                          wall.accepted
                            ? "bg-accent/15 text-accent"
                            : "text-ink-subtle hover:bg-surface-2",
                        )}
                      >
                        <span>{wall.length.toFixed(2)} m</span>
                        <span>
                          {(wall.thickness * 100).toFixed(0)} cm ·{" "}
                          {Math.round(wall.confidence * 100)}%
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={acceptedCount === 0}
                      onClick={() => {
                        const created = applyProposal();
                        setMessage({
                          kind: "info",
                          text: `${created} muros creados. Puedes deshacer con Ctrl+Z.`,
                        });
                      }}
                      className="flex-1 rounded border border-accent/60 bg-accent/15 px-2 py-1 text-[11px] text-accent enabled:hover:bg-accent/25 disabled:opacity-40"
                    >
                      Crear {acceptedCount} muros
                    </button>
                    <button
                      type="button"
                      onClick={() => setProposal(null)}
                      className="rounded border border-line-strong px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2"
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              ) : null}

              <p className="text-[10px] leading-relaxed text-ink-subtle">
                La deteccion es geometrica y no interpreta simbolos: encuentra
                muros rectos, no puertas ni ventanas. Revisa siempre el
                resultado antes de crearlo.
              </p>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
