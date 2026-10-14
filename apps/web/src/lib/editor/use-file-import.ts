"use client";

import { useCallback, useState, type ChangeEvent } from "react";
import {
  assignOpeningsToWalls,
  loadGlbBounds,
  readGlbBounds,
  rememberGlbBounds,
} from "@archvision/shared";
import type { SceneCommand, Vector2 } from "@archvision/types";
import { ENTITY_NAME_MAX } from "@archvision/validation";
import { sniff, type SniffResult } from "@/lib/storage/sniff";
import { useEditorStore } from "./store";
import { uploadProjectFile } from "./write-channel";

export interface ProjectFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  url: string;
}

export interface FileImportOptions {
  /** Project ID for API calls (required for existing projects) */
  projectId?: string;
  /** Active floor ID for model placement */
  activeFloorId?: string | null;
  /** Called when a file is successfully processed */
  onSuccess?: (file: ProjectFile, kind: "floorplan" | "model") => void;
  /** Called when an error occurs */
  onError?: (message: string) => void;
  /** Auto-trigger AI analysis for floorplans after upload */
  autoAnalyzeFloorplan?: boolean;
}

export interface FileImportResult {
  file: ProjectFile | null;
  kind: "floorplan" | "model" | null;
  error: string | null;
}

/**
 * Tipos de archivo aceptados por categoria.
 * Centraliza la logica de validacion para evitar duplicidad.
 */
export const ACCEPTED_FILE_TYPES = {
  floorplan: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
  model: ["model/gltf-binary", "model/gltf+json", "application/octet-stream"],
  all: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
    "model/gltf-binary",
    "model/gltf+json",
    "application/octet-stream",
  ],
} as const;

export const ACCEPTED_EXTENSIONS = {
  floorplan: [".png", ".jpg", ".jpeg", ".webp", ".pdf"],
  model: [".glb", ".gltf"],
  all: [".png", ".jpg", ".jpeg", ".webp", ".pdf", ".glb", ".gltf"],
} as const;

// Vistas ensanchadas para poder usar `.includes()` con valores dinamicos
// sin perder la tipificacion literal de las constantes de arriba.
const FLOORPLAN_EXTENSIONS = ACCEPTED_EXTENSIONS.floorplan as readonly string[];
const MODEL_EXTENSIONS = ACCEPTED_EXTENSIONS.model as readonly string[];
const FLOORPLAN_TYPES = ACCEPTED_FILE_TYPES.floorplan as readonly string[];
const MODEL_TYPES = ACCEPTED_FILE_TYPES.model as readonly string[];

/**
 * Detecta el tipo de archivo (floorplan | model) basandose en la extension y MIME.
 * Para GLB/GLTF usa deteccion por magic bytes via sniff().
 */
export function detectFileKind(file: File, sniffResult: SniffResult | null): "floorplan" | "model" | null {
  // GLB/GLTF detection via magic bytes (most reliable)
  if (sniffResult?.mime === "model/gltf-binary" || sniffResult?.mime === "model/gltf+json") {
    return "model";
  }

  // Fallback to extension/MIME for images/PDF
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension && MODEL_EXTENSIONS.includes(`.${extension}`)) {
    return "model";
  }
  if (extension && FLOORPLAN_EXTENSIONS.includes(`.${extension}`)) {
    return "floorplan";
  }

  // MIME type fallback - include application/octet-stream for binary blobs
  if (MODEL_TYPES.includes(file.type)) return "model";
  if (FLOORPLAN_TYPES.includes(file.type)) return "floorplan";

  // If MIME is application/octet-stream, check extension as final fallback
  if (file.type === "application/octet-stream" && extension) {
    if (MODEL_EXTENSIONS.includes(`.${extension}`)) return "model";
    if (FLOORPLAN_EXTENSIONS.includes(`.${extension}`)) return "floorplan";
  }

  return null;
}

/**
 * Valida un archivo contra los tipos permitidos.
 * La comprobacion real (magic bytes) se hace al subir, sobre los bytes.
 */
export function validateFile(file: File): { valid: boolean; error: string | null } {
  if (file.size === 0) {
    return { valid: false, error: "El archivo esta vacio" };
  }

  // Hard limit: 60MB (matches server-side limit in file upload API)
  if (file.size > 60 * 1024 * 1024) {
    return { valid: false, error: "El archivo supera el limite de 60 MB" };
  }

  const kind = detectFileKind(file, null);
  if (!kind) {
    const accepted = [...ACCEPTED_EXTENSIONS.floorplan, ...ACCEPTED_EXTENSIONS.model].join(", ");
    return {
      valid: false,
      error: `Formato no soportado. Formatos aceptados: ${accepted}`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Hook unificado para importacion de archivos (planos 2D y modelos 3D).
 * Centraliza: validacion, subida, manejo de estados, y enrutamiento por tipo.
 */
export function useFileImport(options: FileImportOptions = {}) {
  const { projectId, activeFloorId, onSuccess, onError, autoAnalyzeFloorplan = false } = options;

  const [busy, setBusy] = useState<"upload" | "detect" | null>(null);
  const [lastResult, setLastResult] = useState<FileImportResult>({ file: null, kind: null, error: null });

  const setMessage = useEditorStore((state) => state.setMessage);
  const addImportedModel = useEditorStore((state) => state.addImportedModel);
  const dispatch = useEditorStore((state) => state.dispatch);

  const refreshFiles = useCallback(async () => {
    if (!projectId) return [];
    const response = await fetch(`/api/projects/${projectId}/files?kind=floorplan`);
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: { files?: ProjectFile[] } };
    return payload.data?.files ?? [];
  }, [projectId]);

  /**
   * Analisis IA de un plano recien subido.
   *
   * El archivo viaja al microservicio en `multipart/form-data`: el proxy de
   * Next valida sesion, tamano y formato, y el servicio responde con la
   * geometria vectorizada. Despues `/apply` traduce esa respuesta a comandos
   * de creacion y se emiten al store, que es lo que hace que la estructura
   * aparezca en la planta 2D y en la extrusione 3D.
   *
   * Antes se enviaba un JSON con el `fileId`, pero el proxy esperaba el
   * archivo: el analisis nunca llegaba a ejecutarse y la escena se quedaba
   * vacia con el plano guardado.
   */
  const analyzeFloorplan = useCallback(
    async (file: File, uploaded: ProjectFile) => {
      if (!projectId) return;
      setBusy("detect");

      try {
        setMessage({ kind: "info", text: "Analizando el plano con IA..." });

        const analysisForm = new FormData();
        analysisForm.append("file", file);

        const analysisResponse = await fetch(
          `/api/projects/${projectId}/ai/floorplan`,
          {
            method: "POST",
            body: analysisForm,
          },
        );

        const analysisPayload = (await analysisResponse.json().catch(() => null)) as {
          data?: Record<string, unknown>;
          error?: { message?: string };
        } | null;

        if (!analysisResponse.ok || !analysisPayload?.data) {
          throw new Error(
            analysisPayload?.error?.message ?? "Fallo el analisis IA del plano",
          );
        }

        const analysisResult = analysisPayload.data;
        setMessage({ kind: "info", text: "Analisis completado. Construyendo la estructura..." });

        const state = useEditorStore.getState();
        // El plano visible es la referencia para colocar la estructura: si el
        // analisis se hizo sobre el mismo archivo, se manda su colocacion
        // (escala calibrada, giro y desplazamiento) y los muros caen dentro de
        // la imagen en lugar de en un sitio arbitrario.
        const underlay = state.scene.underlay ?? null;
        const placement =
          underlay && underlay.fileId === uploaded.id
            ? {
                pixelsPerMeter: underlay.pixelsPerMeter,
                offset: underlay.offset,
                rotationDeg: underlay.rotationDeg,
              }
            : undefined;

        const applyResponse = await fetch(
          `/api/projects/${projectId}/ai/floorplan/apply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              result: analysisResult,
              activeFloorId: state.activeFloorId,
              ...(placement ? { underlay: placement } : {}),
            }),
          },
        );

        const applyPayload = (await applyResponse.json().catch(() => null)) as {
          data?: {
            commands?: SceneCommand[];
            openings?: Array<{ kind: "door" | "window"; center: Vector2; width: number }>;
            message?: string;
          };
          error?: { message?: string };
        } | null;

        if (!applyResponse.ok || !applyPayload?.data) {
          throw new Error(
            applyPayload?.error?.message ?? "No se pudo traducir el analisis a geometria",
          );
        }

        const commands = applyPayload.data.commands ?? [];
        if (commands.length === 0) {
          setMessage({
            kind: "info",
            text: applyPayload.data.message ?? "El analisis no encontro muros.",
          });
          return;
        }

        const store = useEditorStore.getState();
        const knownWallIds = new Set(store.scene.walls.map((wall) => wall.id));

        // Un lote, un solo paso de deshacer: la estructura que entra de golpe
        // se deshace con un Ctrl+Z como cualquier otra edicion.
        if (!store.dispatchBatch(commands)) return;

        const createdWalls = useEditorStore
          .getState()
          .scene.walls.filter((wall) => !knownWallIds.has(wall.id));

        // Las aperturas necesitan un muro ya existente (el vano cuelga de un
        // id concreto), asi que se resuelven contra los muros recien creados.
        const openings = applyPayload.data.openings ?? [];
        const openingCommands: SceneCommand[] = [];

        if (openings.length > 0) {
          const assignments = assignOpeningsToWalls(createdWalls, openings);
          for (const assignment of assignments) {
            const wall = createdWalls[assignment.wallIndex];
            const opening = openings[assignment.openingIndex];
            if (!wall || !opening) continue;

            openingCommands.push(
              opening.kind === "door"
                ? {
                    type: "CREATE_DOOR",
                    origin: "ai",
                    wallId: wall.id,
                    offset: assignment.offset,
                    width: opening.width,
                  }
                : {
                    type: "CREATE_WINDOW",
                    origin: "ai",
                    wallId: wall.id,
                    offset: assignment.offset,
                    width: opening.width,
                  },
            );
          }
        }

        if (openingCommands.length > 0) {
          useEditorStore.getState().dispatchBatch(openingCommands);
        }

        const rooms = useEditorStore.getState().scene.rooms.length;
        setMessage({
          kind: "info",
          text:
            `${createdWalls.length} muros` +
            `${openingCommands.length > 0 ? ` y ${openingCommands.length} vanos` : ""}` +
            ` creados desde el analisis IA.` +
            `${rooms > 0 ? ` ${rooms} recintos cerrados.` : ""}` +
            " Ctrl+Z para deshacer.",
        });
      } catch (analysisError) {
        console.error("[useFileImport] Error en analisis IA:", analysisError);
        setMessage({
          kind: "error",
          text:
            analysisError instanceof Error
              ? analysisError.message
              : "Error al analizar el plano con IA",
        });
      } finally {
        setBusy(null);
      }
    },
    [projectId, setMessage],
  );

  const uploadFile = useCallback(
    async (file: File): Promise<FileImportResult> => {
      setBusy("upload");
      setLastResult({ file: null, kind: null, error: null });

      try {
        // Read file for sniff validation
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const sniffResult = sniff(data);

        if (!sniffResult) {
          throw new Error("Formato no reconocido. Se aceptan PNG, JPG, WebP, PDF, GLB y GLTF.");
        }

        const kind = detectFileKind(file, sniffResult);
        if (!kind) {
          throw new Error(`Tipo de archivo no soportado: ${sniffResult.mime}`);
        }

        // Upload to server: pasa por el canal serializado del proyecto, con
        // reintentos idempotentes (misma clientKey en cada reintento) y sin
        // solaparse jamas con un guardado de escena en vuelo.
        const uploadUrl = projectId
          ? `/api/projects/${projectId}/files`
          : "/api/projects/upload"; // For new project creation (will create temp project)

        const { file: uploaded, revision } = await uploadProjectFile({
          url: uploadUrl,
          file,
          kind,
        });

        // La respuesta trae la revision vigente de la escena: el siguiente
        // guardado usa esa base aunque el upload no cambie el documento.
        if (typeof revision === "number") {
          useEditorStore.getState().adoptRevision(revision);
        }

        // Post-upload handling based on kind
        if (kind === "model") {
          // GLB/GLTF: load directly as imported model
          const modelUrl = projectId
            ? `/api/projects/${projectId}/files/${uploaded.id}/content`
            : uploaded.url;

          // La planta dibuja SVG y no puede cargar el GLB para saber cuanto
          // ocupa. La cabecera del archivo ya está en memoria: con ella se
          // calcula la caja ahora y la vista 2D la usa sin bloquear nadie.
          const bounds = readGlbBounds(data);
          if (bounds) rememberGlbBounds(modelUrl, bounds);
          else void loadGlbBounds(modelUrl);

          const floorId = activeFloorId ?? "";
          addImportedModel({
            id: uploaded.id,
            fileId: uploaded.id,
            // Recorte al tope del esquema: un nombre de archivo mas largo
            // dejaria la escena invalida y el guardado fallaria.
            name: uploaded.originalName.trim().slice(0, ENTITY_NAME_MAX) || "Modelo importado",
            url: modelUrl,
            floorId,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            visible: true,
            locked: false,
          });

          setMessage({
            kind: "info",
            text: `Modelo 3D "${uploaded.originalName}" cargado. Ya puedes verlo en el visor 3D y su planta en el 2D.`,
          });
        } else if (kind === "floorplan") {
          // 2D plan: create underlay for calibration
          if (uploaded.mimeType === "application/pdf") {
            setMessage({
              kind: "info",
              text: "PDF guardado. El servicio lo rasteriza y reconstruye la estructura a escala aproximada (100 px/m).",
            });
          } else if (uploaded.width && uploaded.height) {
            const underlay = {
              fileId: uploaded.id,
              pixelsPerMeter: 50,
              offset: { x: 0, y: 0 },
              rotationDeg: 0,
              opacity: 0.55,
              visible: true,
              width: uploaded.width,
              height: uploaded.height,
            };
            dispatch({ type: "SET_UNDERLAY", underlay });
            setMessage({
              kind: "info",
              text: "Plano colocado. Marca una medida conocida para fijar la escala.",
            });
          } else {
            setMessage({ kind: "error", text: "No se pudieron leer las dimensiones del plano" });
          }

          // Auto-trigger AI analysis for floorplans
          if (autoAnalyzeFloorplan && projectId) {
            await analyzeFloorplan(file, uploaded);
          }
        }

        const result = { file: uploaded, kind, error: null };
        setLastResult(result);
        onSuccess?.(uploaded, kind);

        if (projectId) await refreshFiles();

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error al procesar el archivo";
        setLastResult({ file: null, kind: null, error: message });
        onError?.(message);
        setMessage({ kind: "error", text: message });
        return { file: null, kind: null, error: message };
      } finally {
        setBusy(null);
      }
    },
    [projectId, activeFloorId, addImportedModel, setMessage, dispatch, onSuccess, onError, refreshFiles, autoAnalyzeFloorplan, analyzeFloorplan],
  );

  const handleFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const file = event.dataTransfer.files[0];
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    busy,
    lastResult,
    uploadFile,
    handleFileSelect,
    handleDrop,
    handleDragOver,
    acceptedTypes: ACCEPTED_FILE_TYPES.all.join(","),
    acceptedExtensions: ACCEPTED_EXTENSIONS.all.join(","),
  };
}

/**
 * Tipos de archivo para el componente AssetDropzone
 */
export type AssetCategory = "floorplan" | "model" | "all";

export interface AssetDropzoneProps {
  /** Categoria de archivos a aceptar */
  category?: AssetCategory;
  /** Callback cuando se selecciona un archivo valido */
  onFileSelect: (file: File) => void;
  /** Estado de carga */
  busy?: boolean;
  /** Texto personalizado */
  label?: string;
  /** Texto de ayuda con formatos aceptados */
  helpText?: string;
  /** Clases CSS adicionales */
  className?: string;
  /** Deshabilitado */
  disabled?: boolean;
  /** ID para el input file */
  inputId?: string;
}