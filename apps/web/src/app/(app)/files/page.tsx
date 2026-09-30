"use client";

import { useState, useEffect } from "react";
import { FileStack, Upload, Search, FileText, Image as ImageIcon, Download, Trash2, FolderOpen, AlertCircle } from "lucide-react";
import { Panel } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

interface ProjectFileItem {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  kind: "floorplan" | "export" | "asset";
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

export default function FilesPage() {
  const [search, setSearch] = useState("");
  const [selectedKind, setSelectedKind] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<ProjectFileItem[]>([]);

  useEffect(() => {
    // Carga inicial simulada / consulta de proyectos
    async function loadUserFiles() {
      try {
        const res = await fetch("/api/projects");
        if (res.ok) {
          const data = await res.json();
          const projects = data.data?.items ?? [];
          
          // Buscar archivos de cada proyecto
          const allFiles: ProjectFileItem[] = [];
          for (const proj of projects) {
            const fRes = await fetch(`/api/projects/${proj.id}/files`);
            if (fRes.ok) {
              const fData = await fRes.json();
              const pFiles = fData.data?.files ?? [];
              for (const f of pFiles) {
                allFiles.push({
                  id: f.id,
                  projectId: proj.id,
                  projectName: proj.name,
                  name: f.originalName ?? f.name ?? "archivo",
                  kind: f.kind ?? "floorplan",
                  sizeBytes: f.sizeBytes ?? 0,
                  mimeType: f.mimeType ?? "application/octet-stream",
                  createdAt: f.createdAt ?? new Date().toISOString(),
                });
              }
            }
          }
          setFiles(allFiles);
        }
      } catch (err) {
        console.error("Error cargando archivos:", err);
      } finally {
        setLoading(false);
      }
    }
    loadUserFiles();
  }, []);

  const filteredFiles = files.filter((f) => {
    const matchesSearch =
      search.trim() === "" ||
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.projectName.toLowerCase().includes(search.toLowerCase());
    const matchesKind = selectedKind === "all" || f.kind === selectedKind;
    return matchesSearch && matchesKind;
  });

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Archivos del Proyecto</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Planos de referencia importados, documentos escaneados y archivos adjuntos de tus espacios.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-ink-muted border border-line">
          <FileStack className="size-4 text-accent" />
          <span>{files.length} archivos almacenados</span>
        </div>
      </div>

      {/* Buscador y Filtros */}
      <Panel>
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-ink-subtle" />
            <input
              type="text"
              placeholder="Buscar por nombre de archivo o proyecto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-4 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-xs font-medium text-ink focus:border-accent focus:outline-none"
            >
              <option value="all">Todos los tipos</option>
              <option value="floorplan">Planos de referencia</option>
              <option value="export">Exportaciones</option>
              <option value="asset">Recursos adjuntos</option>
            </select>
          </div>
        </div>
      </Panel>

      {/* Lista / Grid de archivos */}
      {loading ? (
        <Panel className="p-12 text-center text-sm text-ink-muted">Cargando lista de archivos...</Panel>
      ) : filteredFiles.length === 0 ? (
        <Panel className="p-12 text-center">
          <FileStack className="mx-auto size-10 text-ink-subtle/50" />
          <p className="mt-3 text-sm font-medium text-ink">No hay archivos cargados aún</p>
          <p className="mt-1 text-xs text-ink-subtle max-w-md mx-auto">
            Puedes importar planos en papel o imágenes de referencia abriendo el editor de cualquiera de tus proyectos.
          </p>
        </Panel>
      ) : (
        <Panel>
          <div className="divide-y divide-line">
            {filteredFiles.map((file) => (
              <div key={file.id} className="flex items-center justify-between gap-4 p-4 hover:bg-surface-2/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 border border-line">
                    {file.mimeType.startsWith("image/") ? (
                      <ImageIcon className="size-5 text-accent" />
                    ) : (
                      <FileText className="size-5 text-ink-muted" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{file.name}</p>
                    <p className="text-xs text-ink-subtle truncate">
                      Proyecto: <span className="text-ink-muted">{file.projectName}</span> • {formatSize(file.sizeBytes)} • {new Date(file.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/api/projects/${file.projectId}/files/${file.id}/content`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 transition-colors"
                  >
                    <Download className="size-3.5" />
                    Descargar
                  </a>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
