"use client";

import { useEffect, useState } from "react";
import { RotateCcw, RotateCw, Trash2 } from "lucide-react";
import type { SceneDocument, UnitSystem } from "@archvision/types";
import {
  distance2,
  formatArea,
  formatLength,
  parseLengthInput,
} from "@archvision/shared";
import {
  readRotationStepDegrees,
  writeRotationStepDegrees,
} from "@/lib/editor/rotation-preference";
import { useEditorStore } from "@/lib/editor/store";

/**
 * Inspector de propiedades.
 *
 * Muestra los parametros de la entidad seleccionada y los edita mediante
 * comandos. Las longitudes se escriben en la unidad del proyecto y se
 * convierten a metros antes de tocar el modelo.
 */

function LengthRow({
  label,
  meters,
  unit,
  onCommit,
  disabled,
  hint,
}: {
  label: string;
  meters: number;
  unit: UnitSystem;
  onCommit: (meters: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const [draft, setDraft] = useState(() => formatLength(meters, unit, { withSuffix: false }));

  useEffect(() => {
    setDraft(formatLength(meters, unit, { withSuffix: false }));
  }, [meters, unit]);

  return (
    <label className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-[11px] text-ink-subtle">{label}</span>
      <span className="flex items-center gap-1">
        <input
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const parsed = parseLengthInput(draft, unit);
            if (parsed === null) {
              setDraft(formatLength(meters, unit, { withSuffix: false }));
              return;
            }
            if (Math.abs(parsed - meters) > 1e-6) onCommit(parsed);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          title={hint}
          className="h-7 w-24 rounded border border-line bg-surface px-2 text-right font-mono text-xs text-ink disabled:opacity-50"
        />
        <span className="w-6 text-[10px] text-ink-subtle">{unit}</span>
      </span>
    </label>
  );
}

function NumberRow({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  return (
    <label className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-[11px] text-ink-subtle">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const parsed = Number(draft);
            if (!Number.isFinite(parsed)) {
              setDraft(String(value));
              return;
            }
            if (parsed !== value) onCommit(parsed);
          }}
          className="h-7 w-24 rounded border border-line bg-surface px-2 text-right font-mono text-xs text-ink"
        />
        <span className="w-6 text-[10px] text-ink-subtle">{suffix ?? ""}</span>
      </span>
    </label>
  );
}

function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-[11px] text-ink-subtle">{label}</span>
      <span className="max-w-40 truncate font-mono text-xs text-ink">{value}</span>
    </div>
  );
}

function MaterialRow({
  label,
  value,
  scene,
  onChange,
}: {
  label: string;
  value: string | undefined;
  scene: SceneDocument;
  onChange: (materialId: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-[11px] text-ink-subtle">{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-36 rounded border border-line bg-surface px-1 text-xs text-ink"
      >
        <option value="">Sin material</option>
        {scene.materials.map((material) => (
          <option key={material.id} value={material.id}>
            {material.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
      {children}
    </p>
  );
}

function RotationControls({
  ids,
  degrees,
  onDegreesChange,
}: {
  ids: string[];
  degrees: string;
  onDegreesChange: (value: string) => void;
}) {
  const dispatch = useEditorStore((state) => state.dispatch);

  const rotate = (direction: -1 | 1) => {
    const amount = Number(degrees);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 360) return;
    dispatch({
      type: "TRANSFORM_OBJECTS",
      ids,
      rotateY: (direction * amount * Math.PI) / 180,
    });
  };

  return (
    <div className="border-b border-line pb-1">
      <SectionTitle>Rotacion</SectionTitle>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <label htmlFor="rotation-step" className="text-[11px] text-ink-subtle">
          Grados por giro
        </label>
        <div className="flex items-center gap-1">
          <input
            id="rotation-step"
            type="number"
            min={1}
            max={360}
            step={1}
            value={degrees}
            onChange={(event) => onDegreesChange(event.target.value)}
            className="h-7 w-16 rounded border border-line bg-surface px-2 text-right font-mono text-xs text-ink"
          />
          <span className="text-[10px] text-ink-subtle">°</span>
          <button
            type="button"
            onClick={() => rotate(-1)}
            title="Girar seleccion a la izquierda"
            aria-label="Girar seleccion a la izquierda"
            className="grid size-7 place-items-center rounded border border-line text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => rotate(1)}
            title="Girar seleccion a la derecha"
            aria-label="Girar seleccion a la derecha"
            className="grid size-7 place-items-center rounded border border-line text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <RotateCw className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Inspector() {
  const scene = useEditorStore((state) => state.scene);
  const units = useEditorStore((state) => state.units);
  const selection = useEditorStore((state) => state.selection);
  const dispatch = useEditorStore((state) => state.dispatch);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const [rotationDegrees, setRotationDegrees] = useState("90");
  const [rotationPreferenceLoaded, setRotationPreferenceLoaded] = useState(false);

  useEffect(() => {
    setRotationDegrees(String(readRotationStepDegrees()));
    setRotationPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (rotationPreferenceLoaded) writeRotationStepDegrees(rotationDegrees);
  }, [rotationDegrees, rotationPreferenceLoaded]);

  const id = selection[0];

  if (!id) {
    return (
      <div className="border-t border-line">
        <SectionTitle>Inspector</SectionTitle>
        <p className="px-3 py-6 text-center text-[11px] text-ink-subtle">
          Selecciona un objeto para ver sus propiedades.
        </p>
      </div>
    );
  }

  const handleDeleteSelection = () => {
    dispatch({ type: "DELETE_OBJECTS", ids: selection });
    clearSelection();
  };

  if (selection.length > 1) {
    return (
      <div className="border-t border-line">
        <SectionTitle>Inspector</SectionTitle>
        <RotationControls
          ids={selection}
          degrees={rotationDegrees}
          onDegreesChange={setRotationDegrees}
        />
        <div className="flex flex-col gap-2 p-3">
          <p className="text-[11px] text-ink-muted">
            {selection.length} objetos seleccionados.
          </p>
          <button
            type="button"
            onClick={handleDeleteSelection}
            className="flex items-center justify-center gap-1.5 rounded border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Eliminar seleccionados
          </button>
        </div>
      </div>
    );
  }

  const wall = scene.walls.find((item) => item.id === id);
  const door = scene.doors.find((item) => item.id === id);
  const window = scene.windows.find((item) => item.id === id);
  const column = scene.columns.find((item) => item.id === id);
  const stair = scene.stairs.find((item) => item.id === id);
  const roof = scene.roofs.find((item) => item.id === id);
  const slab = scene.slabs.find((item) => item.id === id);
  const room = scene.rooms.find((item) => item.id === id);
  const furniture = scene.furniture.find((item) => item.id === id);

  return (
    <div className="flex max-h-[45%] flex-col border-t border-line">
      <SectionTitle>Inspector</SectionTitle>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <RotationControls
          ids={selection}
          degrees={rotationDegrees}
          onDegreesChange={setRotationDegrees}
        />
        {wall ? (
          <>
            <TextRow label="Tipo" value="Pared" />
            <TextRow label="Nombre" value={wall.name} />
            <LengthRow
              label="Longitud"
              meters={distance2(wall.start, wall.end)}
              unit={units}
              hint="Mueve el extremo final manteniendo la direccion"
              onCommit={(length) => {
                const current = distance2(wall.start, wall.end) || 1;
                const factor = length / current;
                dispatch({
                  type: "UPDATE_WALL",
                  wallId: wall.id,
                  patch: {
                    end: {
                      x: wall.start.x + (wall.end.x - wall.start.x) * factor,
                      y: wall.start.y + (wall.end.y - wall.start.y) * factor,
                    },
                  },
                });
              }}
            />
            <LengthRow
              label="Altura"
              meters={wall.height}
              unit={units}
              onCommit={(height) =>
                dispatch({ type: "UPDATE_WALL", wallId: wall.id, patch: { height } })
              }
            />
            <LengthRow
              label="Grosor"
              meters={wall.thickness}
              unit={units}
              onCommit={(thickness) =>
                dispatch({ type: "UPDATE_WALL", wallId: wall.id, patch: { thickness } })
              }
            />
            <TextRow
              label="Inicio"
              value={`${wall.start.x.toFixed(2)} , ${wall.start.y.toFixed(2)}`}
            />
            <TextRow
              label="Fin"
              value={`${wall.end.x.toFixed(2)} , ${wall.end.y.toFixed(2)}`}
            />
            <MaterialRow
              label="Material interior"
              value={wall.materialInteriorId}
              scene={scene}
              onChange={(materialId) =>
                dispatch({
                  type: "ASSIGN_MATERIAL",
                  targetIds: [wall.id],
                  materialId,
                  face: "interior",
                })
              }
            />
            <MaterialRow
              label="Material exterior"
              value={wall.materialExteriorId}
              scene={scene}
              onChange={(materialId) =>
                dispatch({
                  type: "ASSIGN_MATERIAL",
                  targetIds: [wall.id],
                  materialId,
                  face: "exterior",
                })
              }
            />
          </>
        ) : null}

        {door ? (
          <>
            <TextRow label="Tipo" value="Puerta" />
            <TextRow label="Nombre" value={door.name} />
            <LengthRow
              label="Ancho"
              meters={door.width}
              unit={units}
              onCommit={(width) =>
                dispatch({
                  type: "UPDATE_OPENING",
                  openingId: door.id,
                  kindOf: "door",
                  patch: { width },
                })
              }
            />
            <LengthRow
              label="Altura"
              meters={door.height}
              unit={units}
              onCommit={(height) =>
                dispatch({
                  type: "UPDATE_OPENING",
                  openingId: door.id,
                  kindOf: "door",
                  patch: { height },
                })
              }
            />
            <LengthRow
              label="Posicion en pared"
              meters={door.offset}
              unit={units}
              onCommit={(offset) =>
                dispatch({
                  type: "UPDATE_OPENING",
                  openingId: door.id,
                  kindOf: "door",
                  patch: { offset },
                })
              }
            />
            <TextRow label="Apertura" value={door.openingDirection} />
          </>
        ) : null}

        {window ? (
          <>
            <TextRow label="Tipo" value="Ventana" />
            <TextRow label="Nombre" value={window.name} />
            <LengthRow
              label="Ancho"
              meters={window.width}
              unit={units}
              onCommit={(width) =>
                dispatch({
                  type: "UPDATE_OPENING",
                  openingId: window.id,
                  kindOf: "window",
                  patch: { width },
                })
              }
            />
            <LengthRow
              label="Altura"
              meters={window.height}
              unit={units}
              onCommit={(height) =>
                dispatch({
                  type: "UPDATE_OPENING",
                  openingId: window.id,
                  kindOf: "window",
                  patch: { height },
                })
              }
            />
            <LengthRow
              label="Antepecho"
              meters={window.sillHeight}
              unit={units}
              onCommit={(sillHeight) =>
                dispatch({
                  type: "UPDATE_OPENING",
                  openingId: window.id,
                  kindOf: "window",
                  patch: { sillHeight },
                })
              }
            />
            <LengthRow
              label="Posicion en pared"
              meters={window.offset}
              unit={units}
              onCommit={(offset) =>
                dispatch({
                  type: "UPDATE_OPENING",
                  openingId: window.id,
                  kindOf: "window",
                  patch: { offset },
                })
              }
            />
          </>
        ) : null}

        {column ? (
          <>
            <TextRow label="Tipo" value="Columna" />
            <TextRow label="Nombre" value={column.name} />
            <TextRow label="Forma" value={column.shape === "circle" ? "Circular" : "Rectangular"} />
            <TextRow
              label="Posicion"
              value={`${column.position.x.toFixed(2)} , ${column.position.y.toFixed(2)}`}
            />
            <TextRow label="Ancho" value={formatLength(column.width, units)} />
            <TextRow label="Altura" value={formatLength(column.height, units)} />
          </>
        ) : null}

        {stair ? (
          <>
            <TextRow label="Tipo" value="Escalera" />
            <TextRow label="Nombre" value={stair.name} />
            <TextRow label="Forma" value={stair.kind} />
            <TextRow label="Altura total" value={formatLength(stair.totalRise, units)} />
            <TextRow label="Escalones" value={String(stair.steps)} />
            <TextRow label="Huella" value={formatLength(stair.tread, units)} />
            <TextRow label="Contrahuella" value={formatLength(stair.riser, units)} />
          </>
        ) : null}

        {roof ? (
          <>
            <TextRow label="Tipo" value="Cubierta" />
            <TextRow label="Nombre" value={roof.name} />
            <TextRow label="Forma" value={roof.kind} />
            <NumberRow
              label="Pendiente"
              value={roof.slopeDeg}
              min={0}
              max={85}
              step={1}
              suffix="°"
              onCommit={(slopeDeg) =>
                dispatch({ type: "UPDATE_ROOF", roofId: roof.id, patch: { slopeDeg } })
              }
            />
            <LengthRow
              label="Alero"
              meters={roof.overhang}
              unit={units}
              onCommit={(overhang) =>
                dispatch({ type: "UPDATE_ROOF", roofId: roof.id, patch: { overhang } })
              }
            />
            <MaterialRow
              label="Material"
              value={roof.materialId}
              scene={scene}
              onChange={(materialId) =>
                dispatch({
                  type: "ASSIGN_MATERIAL",
                  targetIds: [roof.id],
                  materialId,
                })
              }
            />
          </>
        ) : null}

        {slab ? (
          <>
            <TextRow label="Tipo" value="Losa" />
            <TextRow label="Nombre" value={slab.name} />
            <TextRow label="Espesor" value={formatLength(slab.thickness, units)} />
            <MaterialRow
              label="Material"
              value={slab.materialId}
              scene={scene}
              onChange={(materialId) =>
                dispatch({ type: "ASSIGN_MATERIAL", targetIds: [slab.id], materialId })
              }
            />
          </>
        ) : null}

        {room ? (
          <>
            <TextRow label="Tipo" value="Habitacion" />
            <TextRow label="Nombre" value={room.name} />
            <TextRow label="Area" value={formatArea(room.area, units)} />
            <TextRow label="Perimetro" value={formatLength(room.perimeter, units)} />
            <MaterialRow
              label="Piso"
              value={room.floorMaterialId}
              scene={scene}
              onChange={(materialId) =>
                dispatch({ type: "ASSIGN_MATERIAL", targetIds: [room.id], materialId })
              }
            />
          </>
        ) : null}

        {furniture ? (
          <>
            <TextRow label="Tipo" value="Mobiliario" />
            <TextRow label="Nombre" value={furniture.name} />
            <TextRow label="Catalogo" value={furniture.catalogId} />
          </>
        ) : null}

        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={handleDeleteSelection}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Eliminar objeto
          </button>
        </div>
      </div>
    </div>
  );
}
