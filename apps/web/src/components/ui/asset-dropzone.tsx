"use client";

import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { Upload, File, Image, Box, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetDropzoneProps, AssetCategory } from "@/lib/editor/use-file-import";

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  floorplan: "plano 2D",
  model: "modelo 3D",
  all: "archivo",
};

const CATEGORY_ICONS = {
  floorplan: Image,
  model: Box,
  all: File,
};

const CATEGORY_ACCEPT: Record<AssetCategory, string> = {
  floorplan: "image/png,image/jpeg,image/webp,application/pdf",
  model: "model/gltf-binary,model/gltf+json,application/octet-stream,.glb,.gltf",
  all: "image/png,image/jpeg,image/webp,application/pdf,model/gltf-binary,model/gltf+json,application/octet-stream,.glb,.gltf",
};

const CATEGORY_EXTENSIONS: Record<AssetCategory, string> = {
  floorplan: ".png,.jpg,.jpeg,.webp,.pdf",
  model: ".glb,.gltf",
  all: ".png,.jpg,.jpeg,.webp,.pdf,.glb,.gltf",
};

/**
 * Componente Dropzone unificado para seleccionar/arrastrar archivos.
 * Agnostico al tipo de proyecto: se configura via categoria.
 */
export function AssetDropzone({
  category = "all",
  onFileSelect,
  busy = false,
  label,
  helpText,
  className,
  disabled = false,
  inputId,
}: AssetDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file && !disabled) onFileSelect(file);
    },
    [onFileSelect, disabled],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
      if (disabled) return;
      const file = event.dataTransfer.files[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect, disabled],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) setIsDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const AcceptIcon = CATEGORY_ICONS[category];
  const accept = CATEGORY_ACCEPT[category];
  const extensions = CATEGORY_EXTENSIONS[category];

  return (
    <div
      className={cn(
        "relative rounded-lg border-2 transition-colors",
        "border-dashed",
        disabled ? "border-line opacity-50 cursor-not-allowed" : "border-line hover:border-accent/50",
        isDragOver && !disabled ? "border-accent bg-accent/5" : "",
        className,
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !disabled) {
          event.preventDefault();
          handleClick();
        }
      }}
      aria-label={label ?? `Subir ${CATEGORY_LABELS[category]}`}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        className="absolute inset-0 opacity-0 cursor-pointer"
        onChange={handleFileSelect}
        disabled={disabled || busy}
        aria-hidden="true"
      />

      <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
        {busy ? (
          <Loader2 className="size-8 animate-spin text-accent" aria-hidden />
        ) : (
          <>
            <AcceptIcon className={cn("size-10", disabled ? "text-ink-muted" : "text-ink-subtle")} aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-medium text-ink">
                {label ?? `Subir ${CATEGORY_LABELS[category]} (${extensions})`}
              </p>
              {helpText && <p className="text-xs text-ink-muted">{helpText}</p>}
            </div>
          </>
        )}
        <Upload className="size-5 text-ink-muted" aria-hidden />
      </div>
    </div>
  );
}