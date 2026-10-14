import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Box } from "lucide-react";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  UNIT_LABELS,
} from "@archvision/types";
import { computeSceneMetrics, formatArea, formatLength } from "@archvision/shared";
import { Badge, Panel, PanelHeader } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { ProjectVersions } from "@/components/projects/project-versions";
import { ImageTo3DGenerator } from "@/components/projects/image-to-3d-generator";
import { requirePageUser } from "@/lib/auth/guards";
import { getProject } from "@/lib/projects/service";
import { listVersions, loadScene } from "@/lib/projects/scene-service";
import { formatBytes, formatRelativeDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Proyecto" };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;

  const project = await getProject(user.id, id);
  if (!project) notFound();

  const [sceneResult, versions] = await Promise.all([
    loadScene(user.id, id),
    listVersions(user.id, id),
  ]);

  const scene = sceneResult?.scene;
  const metrics = scene ? computeSceneMetrics(scene) : null;
  const unit = project.units;

  const summary = [
    ["Tipo", PROJECT_TYPE_LABELS[project.type]],
    ["Unidades", UNIT_LABELS[unit]],
    ["Ubicacion", project.location ?? "sin definir"],
    ["Altura de piso", formatLength(project.floorHeight, unit)],
    ["Plantas", String(project.floorsCount)],
    ["Tamaño", formatBytes(project.sizeBytes)],
    ["Revision de escena", sceneResult ? `#${sceneResult.revision}` : "-"],
    ["Actualizado", formatRelativeDate(project.updatedAt)],
  ] as const;

  const analytics = metrics
    ? ([
        ["Area util", formatArea(metrics.usableArea, unit)],
        ["Area construida", formatArea(metrics.builtArea, unit)],
        ["Superficie de paredes", formatArea(metrics.wallSurface, unit)],
        ["Superficie acristalada", formatArea(metrics.glazedSurface, unit)],
        ["Superficie de cubierta", formatArea(metrics.roofSurface, unit)],
        ["Volumen aproximado", `${metrics.volume.toFixed(1)} m³`],
        ["Habitaciones", String(metrics.roomCount)],
        ["Puertas / ventanas", `${metrics.doorCount} / ${metrics.windowCount}`],
      ] as const)
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-xs text-ink-subtle hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Proyectos
          </Link>
          <h1 className="mt-2 truncate text-xl font-semibold tracking-tight">
            {project.name}
          </h1>
          {project.description ? (
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">{project.description}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone={project.status === "ready" ? "ok" : "neutral"}>
              {PROJECT_STATUS_LABELS[project.status]}
            </Badge>
            <Badge>{PROJECT_TYPE_LABELS[project.type]}</Badge>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Link href={`/projects/${project.id}/editor`}>
            <Button size="lg">
              <Box className="size-4" aria-hidden />
              Abrir editor 3D
            </Button>
          </Link>
          <span className="text-[11px] text-ink-subtle">
            Editor 2D y 3D sincronizados
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Resumen" description="Datos del proyecto" />
            <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
              {summary.map(([label, value]) => (
                <div key={label} className="bg-surface px-4 py-3">
                  <dt className="text-[11px] text-ink-subtle">{label}</dt>
                  <dd className="mt-0.5 truncate text-sm text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel>
            <PanelHeader
              title="Analitica arquitectonica"
              description="Calculo aproximado, no certificado"
            />
            {metrics ? (
              <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
                {analytics.map(([label, value]) => (
                  <div key={label} className="bg-surface px-4 py-3">
                    <dt className="text-[11px] text-ink-subtle">{label}</dt>
                    <dd className="mt-0.5 truncate font-mono text-sm text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="px-4 py-6 text-sm text-ink-muted">
                La escena aun no esta disponible.
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Contenido de la escena"
              description="Entidades parametricas almacenadas"
            />
            {scene ? (
              <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
                {[
                  ["Niveles", scene.floors.length],
                  ["Paredes", scene.walls.length],
                  ["Puertas", scene.doors.length],
                  ["Ventanas", scene.windows.length],
                  ["Losas", scene.slabs.length],
                  ["Cubiertas", scene.roofs.length],
                  ["Escaleras", scene.stairs.length],
                  ["Mobiliario", scene.furniture.length],
                ].map(([label, count]) => (
                  <li key={String(label)} className="bg-surface px-4 py-3">
                    <p className="text-[11px] text-ink-subtle">{label}</p>
                    <p className="mt-0.5 font-mono text-sm text-ink">{count}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>

          <ImageTo3DGenerator projectId={project.id} />
        </div>

        <div className="space-y-6">
          <ProjectVersions projectId={project.id} initialVersions={versions ?? []} />

          <Panel className="p-4">
            <h2 className="text-sm font-semibold text-ink">Proximas fases</h2>
            <ul className="mt-3 space-y-2 text-xs text-ink-muted">
              <li>Fase 2: editor 3D con paredes, puertas y ventanas.</li>
              <li>Fase 3: editor 2D sincronizado.</li>
              <li>Fase 5: importacion de planos.</li>
              <li>Generacion de modelos desde imagen disponible con TripoSR.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
