"use client";

import { useState, useMemo } from "react";
import {
  FURNITURE_CATALOG,
  FURNITURE_CATEGORY_LABELS,
  FurnitureCatalogItem,
  FurnitureCategory,
} from "@archvision/shared";
import { Search, Sofa, Copy, Check, Filter, MoveHorizontal, MoveVertical, Box } from "lucide-react";
import { Panel } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

export default function FurnitureLibraryPage() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = Object.entries(FURNITURE_CATEGORY_LABELS) as [FurnitureCategory, string][];
    return [{ id: "all", label: "Todas las categorias" }, ...cats.map(([id, label]) => ({ id, label }))];
  }, []);

  const filteredFurniture = useMemo(() => {
    return FURNITURE_CATALOG.filter((item) => {
      const matchesSearch =
        search.trim() === "" ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.id.toLowerCase().includes(search.toLowerCase()) ||
        item.category.toLowerCase().includes(search.toLowerCase());

      const matchesCat = selectedCategory === "all" || item.category === selectedCategory;

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
          <h1 className="text-xl font-semibold tracking-tight text-ink">Biblioteca de Muebles</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Catálogo de mobiliario arquitectónico paramétrico con dimensiones reales de distribución.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-ink-muted border border-line">
          <Sofa className="size-4 text-accent" />
          <span>{FURNITURE_CATALOG.length} muebles disponibles</span>
        </div>
      </div>

      {/* Buscador y Filtros */}
      <Panel>
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-ink-subtle" />
            <input
              type="text"
              placeholder="Buscar mobiliario por nombre o id (ej: sofa-3-seat)..."
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

      {/* Rejilla de Muebles */}
      {filteredFurniture.length === 0 ? (
        <Panel className="p-12 text-center">
          <p className="text-sm text-ink-muted">No se encontraron piezas de mobiliario que coincidan.</p>
          <Button variant="outline" className="mt-3 text-xs" onClick={() => { setSearch(""); setSelectedCategory("all"); }}>
            Limpiar filtros
          </Button>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filteredFurniture.map((item) => (
            <FurnitureCard
              key={item.id}
              item={item}
              isCopied={copiedId === item.id}
              onCopy={() => handleCopyId(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FurnitureCard({
  item,
  isCopied,
  onCopy,
}: {
  item: FurnitureCatalogItem;
  isCopied: boolean;
  onCopy: () => void;
}) {
  const categoryLabel = FURNITURE_CATEGORY_LABELS[item.category] ?? item.category;

  return (
    <Panel className="group relative overflow-hidden transition-all hover:border-accent/50 hover:shadow-sm">
      <div className="relative flex h-28 w-full items-center justify-center border-b border-line bg-surface-2">
        <div
          className="flex size-14 items-center justify-center rounded-lg shadow-inner border border-line/40"
          style={{ backgroundColor: item.color }}
        >
          <Box className="size-7 text-white/90 drop-shadow" />
        </div>
        <button
          onClick={onCopy}
          title="Copiar ID"
          className="absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
        >
          {isCopied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
        </button>
      </div>

      <div className="space-y-3 p-3.5">
        <div>
          <div className="flex items-center justify-between gap-1">
            <h3 className="text-sm font-semibold text-ink truncate">{item.name}</h3>
            <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {categoryLabel}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-mono text-ink-subtle truncate">{item.id}</p>
        </div>

        {/* Dimensiones Reales */}
        <div className="space-y-1 rounded-md bg-surface-2 p-2 text-[11px] text-ink-muted border border-line/50">
          <div className="flex items-center justify-between">
            <span className="text-ink-subtle">Ancho (X):</span>
            <span className="font-mono">{item.size.x.toFixed(2)} m</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-subtle">Alto (Y):</span>
            <span className="font-mono">{item.size.y.toFixed(2)} m</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-subtle">Fondo (Z):</span>
            <span className="font-mono">{item.size.z.toFixed(2)} m</span>
          </div>
        </div>

        {item.wallMounted && (
          <span className="inline-block rounded border border-accent/20 bg-accent/5 px-2 py-0.5 text-[10px] font-medium text-accent">
            Adosable a pared
          </span>
        )}
      </div>
    </Panel>
  );
}
