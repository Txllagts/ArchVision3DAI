"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Trash2, X } from "lucide-react";
import {
  MATERIAL_CATEGORY_LABELS,
  materialsForUsage,
  type MaterialUsage,
} from "@archvision/shared";
import type { MaterialCategory, MaterialDefinition } from "@archvision/types";
import { useEditorStore } from "@/lib/editor/store";
import { materialPreviewUrl } from "@/lib/editor/material-preview";
import { cn } from "@/lib/utils";

/**
 * Biblioteca de materiales.
 *
 * Dos formas de aplicar, porque sirven a momentos distintos: arrastrar una
 * muestra sobre un objeto es lo natural cuando se pinta una superficie suelta,
 * y cargar el pincel es mas rapido cuando hay que repetir el mismo material en
 * muchas caras seguidas.
 */

const FILTERS: Array<{ id: MaterialUsage | "all"; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "wall", label: "Muros" },
  { id: "floor", label: "Suelos" },
  { id: "roof", label: "Cubiertas" },
  { id: "furniture", label: "Mobiliario" },
  { id: "opening", label: "Carpinteria" },
];

function MaterialCard({
  material,
  active,
  onPick,
}: {
  material: MaterialDefinition;
  active: boolean;
  onPick: () => void;
}) {
  const requestDrop = useEditorStore((state) => state.requestDrop);
  const preview = useMemo(() => materialPreviewUrl(material), [material]);

  return (
    <button
      type="button"
      draggable
      onClick={onPick}
      onDragStart={(event) => {
        // El identificador viaja tambien por `dataTransfer` para que un futuro
        // arrastre entre ventanas o hacia otra herramienta siga funcionando.
        event.dataTransfer.setData("application/x-archvision-material", material.id);
        event.dataTransfer.effectAllowed = "copy";
        onPick();
      }}
      onDragEnd={() => requestDrop(null)}
      title={`${material.name} - ${MATERIAL_CATEGORY_LABELS[material.category]}`}
      className={cn(
        "group relative overflow-hidden rounded-md border text-left transition-colors",
        active
          ? "border-accent ring-1 ring-accent/50"
          : "border-line hover:border-line-strong",
      )}
    >
      <span
        className="block h-12 w-full bg-cover bg-center"
        style={
          preview
            ? { backgroundImage: `url(${preview})` }
            : { backgroundColor: material.baseColor }
        }
        aria-hidden
      />
      <span className="block truncate px-1.5 py-1 text-[10px] text-ink-muted">
        {material.name}
      </span>
      {active ? (
        <Check className="absolute right-1 top-1 size-3.5 rounded-sm bg-accent text-canvas" aria-hidden />
      ) : null}
    </button>
  );
}

export function MaterialsPanel() {
  const open = useEditorStore((state) => state.materialsOpen);
  const setOpen = useEditorStore((state) => state.setMaterialsOpen);
  const materials = useEditorStore((state) => state.scene.materials);
  const activeMaterialId = useEditorStore((state) => state.activeMaterialId);
  const setActiveMaterialId = useEditorStore((state) => state.setActiveMaterialId);
  const setTool = useEditorStore((state) => state.setTool);
  const dispatch = useEditorStore((state) => state.dispatch);
  const selection = useEditorStore((state) => state.selection);

  const [filter, setFilter] = useState<MaterialUsage | "all">("all");
  const [query, setQuery] = useState("");

  const allowedIds = useMemo(() => {
    if (filter === "all") return null;
    return new Set(materialsForUsage(filter).map((item) => item.id));
  }, [filter]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return materials.filter((material) => {
      // Los materiales propios del usuario no estan clasificados por uso, asi
      // que nunca se ocultan tras un filtro: perderlos seria peor que mostrar
      // uno de mas.
      if (allowedIds && material.builtin && !allowedIds.has(material.id)) return false;
      if (!needle) return true;
      return material.name.toLowerCase().includes(needle);
    });
  }, [materials, allowedIds, query]);

  const grouped = useMemo(() => {
    const map = new Map<MaterialCategory, MaterialDefinition[]>();
    for (const material of visible) {
      const list = map.get(material.category);
      if (list) list.push(material);
      else map.set(material.category, [material]);
    }
    return Array.from(map.entries());
  }, [visible]);

  const active = materials.find((material) => material.id === activeMaterialId) ?? null;

  if (!open) return null;

  return (
    <div className="absolute left-4 top-4 z-30 flex max-h-[calc(100%-2rem)] w-72 flex-col rounded-panel border border-line bg-surface/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-xs font-semibold text-ink">Materiales</h2>
        <button
          type="button"
          aria-label="Cerrar biblioteca de materiales"
          onClick={() => setOpen(false)}
          className="text-ink-subtle hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="space-y-2 border-b border-line px-3 py-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar material"
          aria-label="Buscar material"
          className="w-full rounded border border-line bg-canvas px-2 py-1 text-[11px] text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px]",
                filter === item.id
                  ? "bg-accent/15 text-accent"
                  : "text-ink-subtle hover:bg-surface-2 hover:text-ink",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {grouped.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-ink-subtle">
            Ningun material coincide.
          </p>
        ) : null}

        {grouped.map(([category, items]) => (
          <section key={category} className="mb-3">
            <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
              {MATERIAL_CATEGORY_LABELS[category]}
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {items.map((material) => (
                <MaterialCard
                  key={material.id}
                  material={material}
                  active={material.id === activeMaterialId}
                  onPick={() => {
                    setActiveMaterialId(material.id);
                    // Elegir un material implica querer aplicarlo: se carga el
                    // pincel salvo que haya una seleccion sobre la que actuar.
                    if (selection.length === 0) setTool("paint");
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="space-y-2 border-t border-line px-3 py-2">
        {active ? (
          <p className="truncate text-[11px] text-ink-muted">
            Pincel: <span className="text-ink">{active.name}</span>
          </p>
        ) : (
          <p className="text-[11px] text-ink-subtle">Sin material en el pincel.</p>
        )}

        <div className="flex gap-1">
          <button
            type="button"
            disabled={!active || selection.length === 0}
            onClick={() => {
              if (!active) return;
              dispatch({
                type: "ASSIGN_MATERIAL",
                targetIds: selection,
                materialId: active.id,
              });
            }}
            className="flex-1 rounded border border-line-strong px-2 py-1 text-[11px] text-ink enabled:hover:bg-surface-2 disabled:opacity-40"
          >
            Aplicar a seleccion ({selection.length})
          </button>

          <button
            type="button"
            disabled={!active}
            title="Duplicar como material propio"
            aria-label="Duplicar material"
            onClick={() => {
              if (!active) return;
              const { id: _id, builtin: _builtin, ...rest } = active;
              dispatch({
                type: "CREATE_MATERIAL",
                material: { ...rest, name: `${active.name} (copia)` },
              });
            }}
            className="grid size-7 place-items-center rounded border border-line-strong text-ink-muted enabled:hover:bg-surface-2 disabled:opacity-40"
          >
            <Copy className="size-3.5" aria-hidden />
          </button>

          <button
            type="button"
            disabled={!active || active.builtin === true}
            title="Eliminar material propio"
            aria-label="Eliminar material"
            onClick={() => {
              if (!active) return;
              if (dispatch({ type: "DELETE_MATERIAL", materialId: active.id })) {
                setActiveMaterialId(null);
              }
            }}
            className="grid size-7 place-items-center rounded border border-line-strong text-ink-muted enabled:hover:bg-danger/15 enabled:hover:text-danger disabled:opacity-40"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
