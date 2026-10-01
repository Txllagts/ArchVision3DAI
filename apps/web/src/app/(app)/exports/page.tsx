"use client";

import { useState, useEffect } from "react";
import { Share2, Box, FileCode, Image as ImageIcon, Cpu, ArrowRight, Download, CheckCircle2 } from "lucide-react";
import { Panel } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

interface ProjectItem {
  id: string;
  name: string;
  updatedAt: string;
}

export default function ExportsPage() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProjects() {
      try {
        const res = await fetch("/api/projects");
        if (res.ok) {
          const data = await res.json();
          setProjects(data.data?.items ?? []);
        }
      } catch (err) {
        console.error("Error cargando proyectos para exportacion:", err);
      } finally {
        setLoading(false);
      }
    }
    loadProjects();
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Centro de Exportaciones</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Exporta tus modelos 3D, planos 2D vectoriales y documentación técnica a múltiples formatos de la industria.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-ink-muted border border-line">
          <Share2 className="size-4 text-accent" />
          <span>Formatos CAD / BIM / 3D</span>
        </div>
      </div>

      {/* Formatos Soportados */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormatCard
          icon={Box}
          title="Formatos 3D"
          formats="GLTF, OBJ, STL"
          description="Modelos 3D optimizados para Blender, Unreal Engine, Unity o impresión 3D."
        />
        <FormatCard
          icon={FileCode}
          title="Planos 2D CAD"
          formats="DXF, SVG"
          description="Planos vectoriales acotados compatibles con AutoCAD, Revit y Rhino."
        />
        <FormatCard
          icon={Cpu}
          title="Estándar BIM"
          formats="IFC 4.0"
          description="Intercambio abierto de información de construcción y elementos arquitectónicos."
        />
        <FormatCard
          icon={ImageIcon}
          title="Render / Imágenes"
          formats="PNG, JPG (4K)"
          description="Capturas de alta resolución de la vista 3D o vista de planta."
        />
      </div>

      {/* Selector de Proyecto para Exportar */}
      <Panel>
        <div className="border-b border-line p-4">
          <h2 className="text-sm font-semibold text-ink">Proyectos disponibles para exportación</h2>
          <p className="text-xs text-ink-subtle">Selecciona un proyecto para abrir sus herramientas de exportación directa.</p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-ink-muted">Cargando proyectos...</div>
        ) : projects.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-muted">No tienes proyectos activos para exportar.</div>
        ) : (
          <div className="divide-y divide-line">
            {projects.map((proj) => (
              <div key={proj.id} className="flex flex-wrap items-center justify-between gap-4 p-4 hover:bg-surface-2/50 transition-colors">
                <div>
                  <h3 className="text-sm font-medium text-ink">{proj.name}</h3>
                  <p className="text-xs text-ink-subtle">
                    Última actualización: {new Date(proj.updatedAt).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/projects/${proj.id}/editor`}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
                  >
                    Abrir Editor y Exportar
                    <ArrowRight className="size-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function FormatCard({
  icon: Icon,
  title,
  formats,
  description,
}: {
  icon: typeof Box;
  title: string;
  formats: string;
  description: string;
}) {
  return (
    <Panel className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex size-9 items-center justify-center rounded-lg bg-accent/10 border border-accent/20">
          <Icon className="size-5 text-accent" />
        </div>
        <span className="rounded bg-surface-2 px-2 py-0.5 text-[10px] font-mono font-medium text-ink-muted border border-line">
          {formats}
        </span>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-xs text-ink-muted leading-relaxed">{description}</p>
      </div>
    </Panel>
  );
}
