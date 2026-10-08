"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, Lock, LockOpen, Trash2 } from "lucide-react";
import type { SceneDocument } from "@archvision/types";
import { useEditorStore } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

/**
 * Outliner jerarquico.
 *
 * Estructura: proyecto > nivel > categoria > entidad. Permite renombrar con
 * doble clic, ocultar y bloquear, siempre a traves de comandos.
 */

interface OutlinerEntry {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

interface OutlinerGroup {
  key: string;
  label: string;
  items: OutlinerEntry[];
}

function groupsForFloor(scene: SceneDocument, floorId: string): OutlinerGroup[] {
  const pick = <T extends { id: string; name: string; floorId: string; visible: boolean; locked: boolean }>(
    items: readonly T[],
  ): OutlinerEntry[] =>
    items
      .filter((item) => item.floorId === floorId)
      .map((item) => ({
        id: item.id,
        name: item.name,
        visible: item.visible,
        locked: item.locked,
      }));

  return [
    { key: "walls", label: "Paredes", items: pick(scene.walls) },
    { key: "doors", label: "Puertas", items: pick(scene.doors) },
    { key: "windows", label: "Ventanas", items: pick(scene.windows) },
    { key: "columns", label: "Columnas", items: pick(scene.columns) },
    { key: "stairs", label: "Escaleras", items: pick(scene.stairs) },
    { key: "slabs", label: "Losas", items: pick(scene.slabs) },
    { key: "roofs", label: "Cubiertas", items: pick(scene.roofs) },
    { key: "furniture", label: "Mobiliario", items: pick(scene.furniture) },
    {
      key: "rooms",
      label: "Habitaciones",
      items: scene.rooms
        .filter((room) => room.floorId === floorId)
        .map((room) => ({ id: room.id, name: room.name, visible: true, locked: false })),
    },
  ].filter((group) => group.items.length > 0);
}

export function Outliner() {
  const scene = useEditorStore((state) => state.scene);
  const selection = useEditorStore((state) => state.selection);
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  const select = useEditorStore((state) => state.select);
  const setHovered = useEditorStore((state) => state.setHovered);
  const dispatch = useEditorStore((state) => state.dispatch);
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor);

  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const selectionSet = useMemo(() => new Set(selection), [selection]);

  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        Outliner
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2 text-xs">
        {scene.floors.map((floor) => {
          const groups = groupsForFloor(scene, floor.id);
          const isActive = floor.id === activeFloorId;

          return (
            <div key={floor.id} className="group/floor mb-2">
              <div
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors",
                  isActive ? "bg-accent/10 text-accent" : "text-ink hover:bg-surface-2",
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveFloor(floor.id)}
                  className="flex flex-1 items-center gap-2 truncate text-left"
                >
                  <span className="truncate font-medium">{floor.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-ink-subtle">
                    {floor.elevation.toFixed(2)} m
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={floor.visible ? `Ocultar ${floor.name}` : `Mostrar ${floor.name}`}
                  title={floor.visible ? `Ocultar ${floor.name}` : `Mostrar ${floor.name}`}
                  className={cn(
                    "transition-opacity",
                    floor.visible
                      ? "opacity-0 group-hover/floor:opacity-100 text-ink-muted hover:text-ink"
                      : "opacity-100 text-warn"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({
                      type: "SET_VISIBILITY",
                      ids: [floor.id],
                      visible: !floor.visible,
                    });
                  }}
                >
                  {floor.visible ? (
                    <Eye className="size-3.5" aria-hidden />
                  ) : (
                    <EyeOff className="size-3.5 text-warn" aria-hidden />
                  )}
                </button>

                {scene.floors.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Eliminar ${floor.name}`}
                    title={`Eliminar ${floor.name}`}
                    className="opacity-0 transition-opacity hover:text-danger group-hover/floor:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "DELETE_OBJECTS", ids: [floor.id] });
                    }}
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </button>
                ) : null}
              </div>

              {groups.map((group) => {
                const groupKey = `${floor.id}:${group.key}`;
                const isCollapsed = collapsed.has(groupKey);

                return (
                  <div key={groupKey} className="ml-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(groupKey)}
                      className="flex w-full items-center gap-1 px-2 py-1 text-[11px] text-ink-subtle hover:text-ink"
                    >
                      <span className="w-3">{isCollapsed ? "+" : "−"}</span>
                      {group.label}
                      <span className="ml-auto font-mono">{group.items.length}</span>
                    </button>

                    {!isCollapsed
                      ? group.items.map((item) => {
                          const isSelected = selectionSet.has(item.id);
                          return (
                            <div
                              key={item.id}
                              className={cn(
                                "group ml-4 flex items-center gap-1 rounded px-2 py-0.5",
                                isSelected
                                  ? "bg-accent/15 text-accent"
                                  : "text-ink-muted hover:bg-surface-2",
                              )}
                              onMouseEnter={() => setHovered(item.id)}
                              onMouseLeave={() => setHovered(null)}
                            >
                              {renaming?.id === item.id ? (
                                <input
                                  autoFocus
                                  value={renaming.value}
                                  onChange={(event) =>
                                    setRenaming({ id: item.id, value: event.target.value })
                                  }
                                  onBlur={() => {
                                    if (renaming.value.trim()) {
                                      dispatch({
                                        type: "RENAME_OBJECT",
                                        id: item.id,
                                        name: renaming.value.trim(),
                                      });
                                    }
                                    setRenaming(null);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                    if (event.key === "Escape") setRenaming(null);
                                  }}
                                  className="h-5 flex-1 rounded border border-accent bg-surface px-1 text-[11px] text-ink"
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={(event) =>
                                    select([item.id], event.shiftKey)
                                  }
                                  onDoubleClick={() =>
                                    setRenaming({ id: item.id, value: item.name })
                                  }
                                  className="flex-1 truncate text-left"
                                  title={item.name}
                                >
                                  {item.name}
                                </button>
                              )}

                              <button
                                type="button"
                                aria-label={item.visible ? "Ocultar" : "Mostrar"}
                                title={item.visible ? "Ocultar" : "Mostrar"}
                                className={cn(
                                  "transition-opacity",
                                  item.visible
                                    ? "opacity-0 group-hover:opacity-100"
                                    : "opacity-100"
                                )}
                                onClick={() =>
                                  dispatch({
                                    type: "SET_VISIBILITY",
                                    ids: [item.id],
                                    visible: !item.visible,
                                  })
                                }
                              >
                                {item.visible ? (
                                  <Eye className="size-3" aria-hidden />
                                ) : (
                                  <EyeOff className="size-3 text-warn" aria-hidden />
                                )}
                              </button>

                              <button
                                type="button"
                                aria-label={item.locked ? "Desbloquear" : "Bloquear"}
                                title={item.locked ? "Desbloquear" : "Bloquear"}
                                className={cn(
                                  "transition-opacity",
                                  item.locked
                                    ? "opacity-0 group-hover:opacity-100 text-warn opacity-100"
                                    : "opacity-0 group-hover:opacity-100"
                                )}
                                onClick={() =>
                                  dispatch({
                                    type: "SET_LOCK",
                                    ids: [item.id],
                                    locked: !item.locked,
                                  })
                                }
                              >
                                {item.locked ? (
                                  <Lock className="size-3 text-warn" aria-hidden />
                                ) : (
                                  <LockOpen className="size-3" aria-hidden />
                                )}
                              </button>

                              <button
                                type="button"
                                aria-label={`Eliminar ${item.name}`}
                                title={`Eliminar ${item.name}`}
                                className="opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                                onClick={() =>
                                  dispatch({
                                    type: "DELETE_OBJECTS",
                                    ids: [item.id],
                                  })
                                }
                              >
                                <Trash2 className="size-3" aria-hidden />
                              </button>
                            </div>
                          );
                        })
                      : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
