"use client";

import { useState, useEffect } from "react";
import { Layers, Clock, History, FolderOpen, ArrowRight, Bookmark, GitCommit } from "lucide-react";
import { Panel } from "@/components/ui/surface";

interface VersionItem {
  id: string;
  version: number;
  label: string;
  createdAt: string;
}

interface ProjectWithVersions {
  id: string;
  name: string;
  updatedAt: string;
  versions: VersionItem[];
}

export default function HistoryPage() {
  const [projects, setProjects] = useState<ProjectWithVersions[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch("/api/projects");
        if (res.ok) {
          const data = await res.json();
          const projList = data.data?.items ?? [];

          const withVers: ProjectWithVersions[] = [];
          for (const proj of projList) {
            const vRes = await fetch(`/api/projects/${proj.id}/versions`);
            let versions: VersionItem[] = [];
            if (vRes.ok) {
              const vData = await vRes.json();
              versions = vData.data?.items ?? [];
            }
            withVers.push({
              id: proj.id,
              name: proj.name,
              updatedAt: proj.updatedAt,
              versions,
            });
          }
          setProjects(withVers);
        }
      } catch (err) {
        console.error("Error cargando historial de versiones:", err);
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Historial y Revisiones</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Control de cambios, autoguardado e instantáneas guardadas de tus proyectos arquitectónicos.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-ink-muted border border-line">
          <History className="size-4 text-accent" />
          <span>Control de versiones</span>
        </div>
      </div>

      {loading ? (
        <Panel className="p-12 text-center text-sm text-ink-muted">Cargando historial de revisiones...</Panel>
      ) : projects.length === 0 ? (
        <Panel className="p-12 text-center">
          <Layers className="mx-auto size-10 text-ink-subtle/50" />
          <p className="mt-3 text-sm font-medium text-ink">No hay proyectos activos registrados</p>
          <p className="mt-1 text-xs text-ink-subtle">Crea un proyecto para comenzar a registrar su historial de cambios.</p>
        </Panel>
      ) : (
        <div className="space-y-6">
          {projects.map((proj) => (
            <Panel key={proj.id} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line bg-surface-2/40 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-surface border border-line">
                    <FolderOpen className="size-4 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{proj.name}</h3>
                    <p className="text-xs text-ink-subtle">
                      Última modificación: {new Date(proj.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <a
                  href={`/projects/${proj.id}/editor`}
                  className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 transition-colors"
                >
                  Ir al editor
                  <ArrowRight className="size-3.5" />
                </a>
              </div>

              <div className="p-4">
                {proj.versions.length === 0 ? (
                  <p className="py-2 text-xs text-ink-subtle italic">
                    Este proyecto no tiene revisiones manuales guardadas todavía. Las revisiones se crean automáticamente al guardar cambios importantes o manualmente desde el editor.
                  </p>
                ) : (
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-line">
                    {proj.versions.map((v) => (
                      <div key={v.id} className="relative flex items-start justify-between gap-4">
                        <div className="absolute -left-6 top-1 flex size-3 items-center justify-center rounded-full bg-accent ring-4 ring-surface" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-ink">{v.label || `Versión v${v.version}`}</span>
                            <span className="rounded bg-accent/10 px-1.5 py-0.2 text-[10px] font-mono text-accent">
                              v{v.version}
                            </span>
                          </div>
                          <p className="text-[11px] text-ink-subtle mt-0.5">
                            Guardado el {new Date(v.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
