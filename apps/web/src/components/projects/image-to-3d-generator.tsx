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
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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

interface GeneratedModel {
  modelUrl: string;
  format: "glb";
  processingSeconds: number;
}

interface ApiResponse {
  data?: GeneratedModel;
  error?: { code?: string; message?: string };
}

function validateImage(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return "Formato no admitido. Selecciona una imagen JPG, PNG o WebP.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "La imagen supera el límite de 20 MB.";
  }
  return null;
}

export function ImageTo3DGenerator({
  projectId,
}: {
  projectId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [model, setModel] = useState<GeneratedModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!file) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function selectFile(nextFile: File | undefined) {
    if (!nextFile) return;
    const validationError = validateImage(nextFile);
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

    setLoading(true);
    setError(null);
    setModel(null);

    const formData = new FormData();
    formData.set("file", file);

    try {
      const response = await fetch(`/api/projects/${projectId}/ai/generate`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as ApiResponse | null;

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "No fue posible generar el modelo 3D.",
        );
      }
      if (!payload?.data?.modelUrl) {
        throw new Error("La respuesta del servidor no incluye el modelo generado.");
      }
      setModel(payload.data);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Ocurrió un error inesperado al generar el modelo.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Generar modelo 3D con IA"
        description="Envía una imagen al microservicio local y previsualiza el resultado."
        action={
          <Badge tone="accent">
            <Rotate3D className="size-3" aria-hidden />
            TripoSR
          </Badge>
        }
      />
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
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
          }`}
        >
          <ImagePlus className="size-6 text-ink-muted" aria-hidden />
          <span className="mt-2 text-sm font-medium text-ink">
            Arrastra una imagen o haz clic para seleccionarla
          </span>
          <span className="mt-1 text-xs text-ink-subtle">
            JPG, PNG o WebP; máximo 20 MB
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => selectFile(event.currentTarget.files?.[0])}
          />
        </label>

        {file && imageUrl ? (
          <div className="flex items-center gap-3 rounded-md border border-line bg-surface-2 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={`Vista previa de ${file.name}`}
              className="size-16 rounded object-cover"
            />
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
              ? "La GPU está procesando la imagen. Esto puede tardar unos minutos."
              : model
                ? `Modelo listo en ${model.processingSeconds.toFixed(1)} s.`
                : "El modelo generado se guarda en el bucket privado models-3d."}
          </p>
          <Button type="submit" loading={loading} disabled={!file || loading}>
            <Upload className="size-4" aria-hidden />
            {loading ? "Generando..." : "Generar modelo"}
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
