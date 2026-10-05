"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  AlertCircle,
  Box,
  CheckCircle2,
  Download,
  ImagePlus,
  Rotate3D,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Panel, PanelHeader } from "@/components/ui/surface";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const FLOORPLAN_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ".pdf",
  ".dwg",
  ".dxf",
]);

const ModelPreview = dynamic(
  () => import("./model-preview").then((module) => module.ModelPreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 items-center justify-center text-xs text-ink-subtle">
        Preparando visor 3D...
      </div>
    ),
  },
);

type GenerationMode = "object" | "floorplan";
type GenerationQuality = "standard" | "hq";

interface GeneratedModel {
  modelUrl: string;
  format: "glb";
  engine: "triposr" | "instantmesh" | "floorplan";
  processingSeconds: number;
}

interface ApiResponse {
  data?: {
    instantMeshAvailable?: boolean;
    modelUrl?: string;
    model_url?: string;
    format?: "glb";
    engine?: "triposr" | "instantmesh";
    processingSeconds?: number;
    processing_seconds?: number;
  };
  error?: { code?: string; message?: string };
}

function fileExtension(file: File): string {
  return file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
}

function validateFile(file: File, mode: GenerationMode): string | null {
  const extension = fileExtension(file);
  const accepted = mode === "object" ? IMAGE_EXTENSIONS : FLOORPLAN_EXTENSIONS;
  if (!accepted.has(extension)) {
    return mode === "object"
      ? "Para crear un objeto, selecciona una imagen JPG, PNG o WebP."
      : "Formato no admitido. Usa PDF, DWG, DXF, JPG, PNG o WebP.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "El archivo supera el límite de 20 MB.";
  }
  return null;
}

export function ImageTo3DGenerator({
  projectId,
}: {
  projectId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<GenerationMode>("object");
  const [quality, setQuality] = useState<GenerationQuality>("standard");
  const [instantMeshAvailable, setInstantMeshAvailable] = useState(false);
  const [checkingInstantMesh, setCheckingInstantMesh] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [model, setModel] = useState<GeneratedModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setCheckingInstantMesh(true);

    void fetch(`/api/projects/${projectId}/ai/generate`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const payload = (await response.json()) as ApiResponse;
        return payload.data?.instantMeshAvailable === true;
      })
      .catch(() => false)
      .then((available) => {
        if (controller.signal.aborted) return;
        setInstantMeshAvailable(available);
        setCheckingInstantMesh(false);
        if (!available) setQuality("standard");
      });

    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function chooseMode(nextMode: GenerationMode) {
    setMode(nextMode);
    if (nextMode === "floorplan") setQuality("standard");
    setFile(null);
    setModel(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function selectFile(nextFile: File | undefined) {
    if (!nextFile || loading) return;
    const validationError = validateFile(nextFile, mode);
    setError(validationError);
    setModel(null);
    if (validationError) {
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(nextFile);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || loading) return;
    if (mode === "object" && quality === "hq" && !instantMeshAvailable) {
      setQuality("standard");
      setError(
        "Alta Calidad no está disponible porque InstantMesh no está configurado en el microservicio.",
      );
      return;
    }

    setLoading(true);
    setError(null);
    setModel(null);

    const formData = new FormData();
    formData.set("file", file);
    if (mode === "object") formData.set("quality", quality);
    const endpoint =
      mode === "object"
        ? `/api/projects/${projectId}/ai/generate`
        : `/api/projects/${projectId}/ai/floorplan`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as ApiResponse | null;

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ??
            (mode === "object"
              ? "No fue posible generar el modelo 3D."
              : "No fue posible analizar y extruir el plano."),
        );
      }
      const modelUrl = payload?.data?.modelUrl ?? payload?.data?.model_url;
      if (!modelUrl) {
        throw new Error("La respuesta del servidor no incluye el modelo GLB generado.");
      }
      setModel({
        modelUrl,
        format: "glb",
        engine:
          mode === "floorplan"
            ? "floorplan"
            : payload?.data?.engine ??
              (quality === "hq" ? "instantmesh" : "triposr"),
        processingSeconds:
          payload?.data?.processingSeconds ??
          payload?.data?.processing_seconds ??
          0,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Ocurrió un error inesperado al procesar el archivo.",
      );
    } finally {
      setLoading(false);
    }
  }

  const extension = file ? fileExtension(file) : "";
  const isRasterPreview = Boolean(file && IMAGE_EXTENSIONS.has(extension));

  return (
    <Panel>
      <PanelHeader
        title="Crear modelo 3D"
        description="Elige el flujo adecuado: reconstrucción visual de objetos o extrusión de planos."
        action={
          <Badge tone="accent">
            {mode === "object" ? (
              <Rotate3D className="size-3" aria-hidden />
            ) : (
              <Box className="size-3" aria-hidden />
            )}
            {mode === "object"
              ? quality === "hq"
                ? "InstantMesh Pro"
                : "TripoSR"
              : "Extrusión 2D"}
          </Badge>
        }
      />
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        <div
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          aria-label="Modo de creación"
        >
          <button
            type="button"
            aria-pressed={mode === "object"}
            disabled={loading}
            onClick={() => chooseMode("object")}
            className={`rounded-md border px-3 py-3 text-left text-sm transition-colors ${
              mode === "object"
                ? "border-accent bg-accent/10 text-ink"
                : "border-line bg-surface-2 text-ink-muted hover:border-accent"
            }`}
          >
            <span className="flex items-center gap-2 font-medium">
              <Rotate3D className="size-4" aria-hidden />
              Crear mueble/objeto (IA 3D)
            </span>
            <span className="mt-1 block text-xs text-ink-subtle">
              Fotos de muebles y objetos; reconstrucción con TripoSR.
            </span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "floorplan"}
            disabled={loading}
            onClick={() => chooseMode("floorplan")}
            className={`rounded-md border px-3 py-3 text-left text-sm transition-colors ${
              mode === "floorplan"
                ? "border-accent bg-accent/10 text-ink"
                : "border-line bg-surface-2 text-ink-muted hover:border-accent"
            }`}
          >
            <span className="flex items-center gap-2 font-medium">
              <Box className="size-4" aria-hidden />
              Importar plano (2D a 3D)
            </span>
            <span className="mt-1 block text-xs text-ink-subtle">
              PDF, imagen o CAD; muros extruidos con geometría determinista.
            </span>
          </button>
        </div>

        {mode === "object" ? (
          <fieldset className="space-y-2" disabled={loading}>
            <legend className="text-xs font-medium text-ink">
              Calidad de reconstrucción
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label
                className={`cursor-pointer rounded-md border px-3 py-3 text-sm transition-colors ${
                  quality === "standard"
                    ? "border-accent bg-accent/10 text-ink"
                    : "border-line bg-surface-2 text-ink-muted hover:border-accent"
                }`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="generation-quality"
                  value="standard"
                  checked={quality === "standard"}
                  onChange={() => setQuality("standard")}
                />
                <span className="block font-medium">Estándar · Rápido</span>
                <span className="mt-1 block text-xs text-ink-subtle">
                  TripoSR: reconstrucción rápida desde una imagen.
                </span>
              </label>
              <label
                className={`rounded-md border px-3 py-3 text-sm transition-colors ${
                  instantMeshAvailable
                    ? `cursor-pointer ${
                        quality === "hq"
                          ? "border-accent bg-accent/10 text-ink"
                          : "border-line bg-surface-2 text-ink-muted hover:border-accent"
                      }`
                    : "cursor-not-allowed border-line bg-surface-2 text-ink-subtle opacity-60"
                }`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="generation-quality"
                  value="hq"
                  checked={quality === "hq"}
                  disabled={!instantMeshAvailable || checkingInstantMesh}
                  onChange={() => {
                    if (instantMeshAvailable) setQuality("hq");
                  }}
                />
                <span className="block font-medium">Alta calidad · Pro</span>
                <span className="mt-1 block text-xs text-ink-subtle">
                  {checkingInstantMesh
                    ? "Comprobando disponibilidad de InstantMesh..."
                    : instantMeshAvailable
                      ? "InstantMesh: reconstrucción mediante vistas múltiples."
                      : "No disponible: InstantMesh no está configurado en el backend."}
                </span>
              </label>
            </div>
          </fieldset>
        ) : null}

        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-5 py-8 text-center transition-colors ${
            dragging
              ? "border-accent bg-accent/5"
              : "border-line-strong bg-surface-2 hover:border-accent"
          } ${loading ? "pointer-events-none opacity-60" : ""}`}
        >
          <ImagePlus className="size-6 text-ink-muted" aria-hidden />
          <span className="mt-2 text-sm font-medium text-ink">
            {mode === "object"
              ? "Arrastra una imagen del objeto o selecciónala"
              : "Arrastra un plano o selecciónalo"}
          </span>
          <span className="mt-1 text-xs text-ink-subtle">
            {mode === "object"
              ? "JPG, PNG o WebP; máximo 20 MB"
              : "PDF, DWG, DXF, JPG, PNG o WebP; máximo 20 MB"}
          </span>
          <input
            ref={inputRef}
            type="file"
            disabled={loading}
            accept={
              mode === "object"
                ? "image/jpeg,image/png,image/webp"
                : ".pdf,.dwg,.dxf,image/jpeg,image/png,image/webp"
            }
            className="sr-only"
            onChange={(event) => selectFile(event.currentTarget.files?.[0])}
          />
        </label>

        {file && previewUrl ? (
          <div className="space-y-3 rounded-md border border-line bg-surface-2 p-3">
            {isRasterPreview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewUrl}
                alt={`Vista previa de ${file.name}`}
                className="max-h-72 w-full rounded object-contain"
              />
            ) : extension === ".pdf" ? (
              <iframe
                src={previewUrl}
                title={`Vista previa de ${file.name}`}
                className="h-72 w-full rounded border-0 bg-white"
              />
            ) : (
              <div className="flex h-32 flex-col items-center justify-center gap-2 rounded bg-surface">
                <Box className="size-8 text-ink-muted" aria-hidden />
                <p className="text-xs text-ink-subtle">
                  Vista previa vectorial no disponible en el navegador.
                </p>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                <p className="text-xs text-ink-subtle">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFile(null);
                  setModel(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                Quitar
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-subtle" aria-live="polite">
            {loading
              ? mode === "object"
                ? quality === "hq"
                  ? "InstantMesh está generando vistas y reconstruyendo el objeto; puede tardar varios minutos."
                  : "La GPU está procesando el objeto con TripoSR. Esto puede tardar unos minutos."
                : "Analizando el plano y extruyendo sus muros..."
              : model
                ? `Modelo listo en ${model.processingSeconds.toFixed(1)} s.`
                : mode === "object"
                    ? quality === "hq"
                      ? "InstantMesh requiere INSTANTMESH_REPO_DIR, INSTANTMESH_PYTHON y sus pesos descargados."
                      : "El objeto se procesa con TripoSR y se guarda en models-3d."
                    : "Los huecos se crean solo desde capas CAD explícitas de puertas/ventanas; raster no infiere huecos."}
          </p>
          <Button type="submit" loading={loading} disabled={!file || loading}>
            <Upload className="size-4" aria-hidden />
            {loading
              ? mode === "object"
                ? quality === "hq"
                  ? "Generando alta calidad..."
                  : "Generando..."
                : "Analizando..."
              : mode === "object"
                ? "Generar objeto 3D"
                : "Extruir plano a 3D"}
          </Button>
        </div>
      </form>

      {model ? (
        <section className="border-t border-line" aria-label="Modelo 3D generado">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-ok" aria-hidden />
              <h3 className="text-sm font-medium text-ink">Vista previa del modelo</h3>
            </div>
            <a
              href={model.modelUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              <Download className="size-3.5" aria-hidden />
              Abrir GLB
            </a>
          </div>
          <div className="h-72 overflow-hidden bg-surface-2">
            <ModelPreview url={model.modelUrl} />
          </div>
        </section>
      ) : (
        <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-ink-subtle">
          <Box className="size-4" aria-hidden />
          La vista previa interactiva aparecerá aquí al terminar la generación.
        </div>
      )}
    </Panel>
  );
}
