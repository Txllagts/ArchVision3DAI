"use client";

import { useState, useMemo } from "react";
import {
  MATERIAL_CATALOG,
  MATERIAL_CATEGORY_LABELS,
  CatalogMaterial,
  MaterialUsage,
} from "@archvision/shared";
import { MaterialCategory } from "@archvision/types";
import { Search, Layers, Copy, Check, Filter } from "lucide-react";
import { Panel } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

const USAGE_LABELS: Record<MaterialUsage, string> = {
  wall: "Pared",
  floor: "Piso",
  roof: "Techo",
  furniture: "Muebles",
  opening: "Vanos",
};

export default function MaterialsLibraryPage() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = Object.entries(MATERIAL_CATEGORY_LABELS) as [MaterialCategory, string][];
    return [{ id: "all", label: "Todas las categorias" }, ...cats.map(([id, label]) => ({ id, label }))];
  }, []);

  const filteredMaterials = useMemo(() => {
    return MATERIAL_CATALOG.filter((mat) => {
      const matchesSearch =
        search.trim() === "" ||
        mat.name.toLowerCase().includes(search.toLowerCase()) ||
        mat.id.toLowerCase().includes(search.toLowerCase()) ||
        mat.category.toLowerCase().includes(search.toLowerCase());

      const matchesCat = selectedCategory === "all" || mat.category === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [search, selectedCategory]);

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Biblioteca de Materiales</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Catálogo completo de materiales procedurales PBR para muros, pisos, techos y mobiliario.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-ink-muted border border-line">
          <Layers className="size-4 text-accent" />
          <span>{MATERIAL_CATALOG.length} materiales disponibles</span>
        </div>
      </div>

      {/* Buscador y Filtros */}
      <Panel>
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-ink-subtle" />
            <input
              type="text"
              placeholder="Buscar por nombre, tipo o id (ej: mat_brick_red)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-4 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
            <Filter className="size-4 shrink-0 text-ink-subtle" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-xs font-medium text-ink focus:border-accent focus:outline-none"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Panel>

      {/* Rejilla de Materiales */}
      {filteredMaterials.length === 0 ? (
        <Panel className="p-12 text-center">
          <p className="text-sm text-ink-muted">No se encontraron materiales que coincidan con la búsqueda.</p>
          <Button variant="outline" className="mt-3 text-xs" onClick={() => { setSearch(""); setSelectedCategory("all"); }}>
            Limpiar filtros
          </Button>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filteredMaterials.map((material) => (
            <MaterialCard
              key={material.id}
              material={material}
              isCopied={copiedId === material.id}
              onCopy={() => handleCopyId(material.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MaterialCard({
  material,
  isCopied,
  onCopy,
}: {
  material: CatalogMaterial;
  isCopied: boolean;
  onCopy: () => void;
}) {
  const categoryLabel = MATERIAL_CATEGORY_LABELS[material.category] ?? material.category;

  return (
    <Panel className="group relative overflow-hidden transition-all hover:border-accent/50 hover:shadow-sm">
      <div className="relative h-28 w-full border-b border-line" style={{ backgroundColor: material.baseColor }}>
        {material.texture && material.texture !== "plain" && (
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:8px_8px]" />
        )}
        <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[10px] font-mono text-white backdrop-blur-sm">
          {material.baseColor}
        </div>
        <button
          onClick={onCopy}
          title="Copiar ID del material"
          className="absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
        >
          {isCopied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
        </button>
      </div>

      <div className="space-y-3 p-3.5">
        <div>
          <div className="flex items-center justify-between gap-1">
            <h3 className="text-sm font-semibold text-ink truncate">{material.name}</h3>
            <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {categoryLabel}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-mono text-ink-subtle truncate">{material.id}</p>
        </div>

        <div className="grid grid-cols-2 gap-1.5 rounded-md bg-surface-2 p-2 text-[11px] text-ink-muted border border-line/50">
          <div>
            <span className="text-ink-subtle">Rugosidad:</span> {Math.round(material.roughness * 100)}%
          </div>
          <div>
            <span className="text-ink-subtle">Metalicidad:</span> {Math.round(material.metalness * 100)}%
          </div>
          <div>
            <span className="text-ink-subtle">Opacidad:</span> {Math.round(material.opacity * 100)}%
          </div>
          <div>
            <span className="text-ink-subtle">Relieve:</span> {material.bump ?? 0}
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {material.usage.map((u) => (
            <span key={u} className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-subtle">
              {USAGE_LABELS[u] ?? u}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}
