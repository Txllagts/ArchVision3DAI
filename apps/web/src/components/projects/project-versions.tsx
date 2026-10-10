"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/surface";
import { formatRelativeDate } from "@/lib/utils";

interface VersionItem {
  id: string;
  label: string;
  createdAt: string;
}

/** Snapshots del proyecto: crear y consultar. La restauracion llega con el editor. */
export function ProjectVersions({
  projectId,
  initialVersions,
}: {
  projectId: string;
  initialVersions: VersionItem[];
}) {
  const router = useRouter();
  const [versions, setVersions] = useState(initialVersions);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createVersion() {
    const trimmed = label.trim();
    if (trimmed.length === 0) {
      setError("Escribe un nombre para la version");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(payload?.error?.message ?? "No fue posible crear la version");
        return;
      }

      const payload = (await response.json()) as { data: { id: string } };
      setVersions((current) => [
        { id: payload.data.id, label: trimmed, createdAt: new Date().toISOString() },
        ...current,
      ]);
      setLabel("");
      router.refresh();
    } catch {
      setError("Sin conexion con el servidor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Versiones" description="Snapshots restaurables" />
      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Version inicial"
            aria-label="Nombre de la version"
            maxLength={120}
            className="h-8 flex-1 rounded-md border border-line bg-surface px-2.5 text-xs text-ink placeholder:text-ink-subtle"
          />
          <Button size="sm" onClick={createVersion} loading={loading}>
            Guardar
          </Button>
        </div>

        {error ? <p className="text-[11px] text-danger">{error}</p> : null}

        {versions.length === 0 ? (
          <p className="text-xs text-ink-subtle">Aun no hay versiones guardadas.</p>
        ) : (
          <ul className="space-y-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2"
              >
                <History className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-ink">{version.label}</p>
                  <p className="text-[11px] text-ink-subtle">
                    {formatRelativeDate(version.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
