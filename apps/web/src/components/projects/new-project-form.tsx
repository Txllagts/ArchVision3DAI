"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { Camera, FileImage, PencilRuler, Square } from "lucide-react";
import {
  PROJECT_TYPES,
  PROJECT_TYPE_LABELS,
  UNIT_LABELS,
  UNIT_SYSTEMS,
  type CreationMethod,
} from "@archvision/types";
import { createProjectSchema } from "@archvision/validation";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Badge, Panel } from "@/components/ui/surface";
import { AssetDropzone } from "@/components/ui/asset-dropzone";
import { cn } from "@/lib/utils";

/**
 * Creacion de proyecto.
 *
 * Los cuatro metodos existen desde el principio para fijar el flujo de
 * producto; los que dependen de vision por computador quedan marcados y
 * crean el proyecto en estado borrador para continuar cuando lleguen.
 */

interface MethodOption {
  id: CreationMethod;
  title: string;
  description: string;
  icon: typeof Camera;
  phase?: string;
}

const METHODS: MethodOption[] = [
  {
    id: "draw",
    title: "Dibujar plano",
    description: "Traza paredes sobre una cuadricula y ve el resultado en 3D.",
    icon: PencilRuler,
  },
  {
    id: "empty",
    title: "Proyecto vacio",
    description: "Abre el editor 3D en blanco y construye desde cero.",
    icon: Square,
  },
  {
    id: "photos",
    title: "Desde fotografias",
    description: "Crea el proyecto y genera un modelo inicial desde una imagen con TripoSR.",
    icon: Camera,
  },
  {
    id: "floorplan",
    title: "Desde plano",
    description: "Importa un PDF, imagen o modelo 3D (GLB/GLTF) y conviertelo en estructura editable.",
    icon: FileImage,
  },
];

export function NewProjectForm() {
  const router = useRouter();
  const [method, setMethod] = useState<CreationMethod>("draw");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [quotaReached, setQuotaReached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importProgress, setImportProgress] = useState<"uploading" | "processing" | null>(null);

  const handleFileSelect = useCallback((file: File) => {
    setImportFile(file);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const raw = {
      ...Object.fromEntries(formData.entries()),
      creationMethod: method,
    };

    const parsed = createProjectSchema.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setLoading(true);

    try {
      let projectId: string;

      if (importFile) {
        // Create project with file upload (multipart/form-data)
        const uploadFormData = new FormData();
        Object.entries(parsed.data).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            uploadFormData.append(key, String(value));
          }
        });
        uploadFormData.append("file", importFile);

        setImportProgress("uploading");
        const response = await fetch("/api/projects", {
          method: "POST",
          body: uploadFormData,
        });
        setImportProgress("processing");

        if (!response.ok) {
          const payload = (await response.json()) as {
            error?: { code?: string; message?: string };
          };
          throw new Error(payload.error?.message ?? "No fue posible crear el proyecto");
        }

        const payload = (await response.json()) as { data: { id: string } };
        projectId = payload.data.id;
      } else {
        // Standard JSON project creation
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        });

        if (!response.ok) {
          const payload = (await response.json()) as {
            error?: { code?: string; message?: string };
          };
          throw new Error(payload.error?.message ?? "No fue posible crear el proyecto");
        }

        const payload = (await response.json()) as { data: { id: string } };
        projectId = payload.data.id;
      }

      router.push(`/projects/${projectId}`);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible crear el proyecto";
      setFormError(message);
      setQuotaReached(message.includes("QUOTA_EXCEEDED") || message.includes("plan"));
    } finally {
      setLoading(false);
      setImportProgress(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_20rem]" noValidate>
      <div className="space-y-6">
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-ink">Como quieres crear el modelo?</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {METHODS.map((option) => {
              const Icon = option.icon;
              const selected = method === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setMethod(option.id);
                    setImportFile(null);
                  }}
                  aria-pressed={selected}
                  className={cn(
                    "rounded-md border p-4 text-left transition-colors",
                    selected
                      ? "border-accent bg-accent/5"
                      : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <Icon
                      className={cn("size-4", selected ? "text-accent" : "text-ink-muted")}
                      aria-hidden
                    />
                  </div>
                  <p className="mt-3 text-sm font-medium text-ink">{option.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    {option.description}
                  </p>
                </button>
              );
            })}
          </div>
        </Panel>

        {method === "floorplan" && (
          <Panel className="space-y-4 p-5">
            <h2 className="text-sm font-semibold text-ink">Archivo a importar</h2>
            <p className="text-xs text-ink-muted">
              Arrastra un plano (PNG, JPG, WebP, PDF) o un modelo 3D (GLB, GLTF).
              Los modelos 3D se cargaran directamente en el visor; los planos requeriran calibracion.
            </p>
            <AssetDropzone
              category="all"
              onFileSelect={handleFileSelect}
              busy={loading || importProgress !== null}
              disabled={loading || importProgress !== null}
              inputId="project-import-file"
            />
            {importFile && (
              <div className="flex items-center justify-between rounded border border-line bg-surface px-3 py-2 text-sm">
                <span className="truncate max-w-[200px]">{importFile.name}</span>
                <span className="ml-2 text-xs text-ink-muted">
                  {(importFile.size / 1024 / 1024).toFixed(2)} MB
                </span>
                <button
                  type="button"
                  onClick={() => setImportFile(null)}
                  disabled={loading || importProgress !== null}
                  className="ml-3 text-ink-subtle hover:text-danger"
                  aria-label="Eliminar archivo"
                >
                  x
                </button>
              </div>
            )}
            {importProgress === "uploading" && (
              <p className="text-xs text-ink-muted">Subiendo archivo...</p>
            )}
            {importProgress === "processing" && (
              <p className="text-xs text-ink-muted">Procesando y creando proyecto...</p>
            )}
          </Panel>
        )}

        <Panel className="space-y-4 p-5">
          <h2 className="text-sm font-semibold text-ink">Informacion basica</h2>

          <TextField
            label="Nombre del proyecto"
            name="name"
            placeholder="Casa Los Robles"
            required
            error={fieldErrors.name}
          />

          <TextAreaField
            label="Descripcion"
            name="description"
            placeholder="Vivienda unifamiliar de dos plantas en lote esquinero."
            error={fieldErrors.description}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Tipo"
              name="type"
              defaultValue="house"
              options={PROJECT_TYPES.map((value) => ({
                value,
                label: PROJECT_TYPE_LABELS[value],
              }))}
              error={fieldErrors.type}
            />
            <SelectField
              label="Unidades"
              name="units"
              defaultValue="m"
              hint="El modelo se almacena siempre en metros"
              options={UNIT_SYSTEMS.map((value) => ({
                value,
                label: UNIT_LABELS[value],
              }))}
              error={fieldErrors.units}
            />
          </div>

          <TextField
            label="Ubicacion (opcional)"
            name="location"
            placeholder="Bucaramanga, Colombia"
            hint="Se usara para la simulacion solar"
            error={fieldErrors.location}
          />
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel className="space-y-4 p-5">
          <h2 className="text-sm font-semibold text-ink">Dimensiones estimadas</h2>

          <TextField
            label="Numero de plantas"
            name="floorsCount"
            type="number"
            min={1}
            max={20}
            step={1}
            defaultValue={1}
            error={fieldErrors.floorsCount}
          />

          <TextField
            label="Area aproximada (m2)"
            name="areaEstimate"
            type="number"
            min={0}
            step="0.01"
            placeholder="120"
            error={fieldErrors.areaEstimate}
          />

          <TextField
            label="Altura de piso (m)"
            name="floorHeight"
            type="number"
            min={1.8}
            max={12}
            step="0.05"
            defaultValue={2.6}
            hint="Altura libre por nivel"
            error={fieldErrors.floorHeight}
          />
        </Panel>

        {formError ? (
          <div
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            <p>{formError}</p>
            {quotaReached ? (
              <Link
                href="/settings/billing"
                className="mt-1 inline-block font-medium underline"
              >
                Ver planes
              </Link>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" size="lg" className="w-full justify-center" loading={loading}>
          Crear proyecto
        </Button>

        <p className="text-[11px] leading-relaxed text-ink-subtle">
          Los modelos generados automaticamente a partir de fotografias pueden
          contener errores dimensionales. Verifique las medidas importantes.
        </p>
      </div>
    </form>
  );
}
