"use client";

import { create } from "zustand";
import { SCENE_SCHEMA_VERSION } from "@archvision/types";
import type {
  Column,
  Door,
  FurnitureInstance,
  ImportedModel,
  Opening,
  Roof,
  SceneCommand,
  SceneDocument,
  Slab,
  Stair,
  UnitSystem,
  Vector2,
  Wall,
  WindowEntity,
} from "@archvision/types";
import {
  CommandError,
  applyCommand,
  createId,
  withRecomputedRooms,
} from "@archvision/shared";
import type { AssistantMessage } from "@archvision/assistant";
import type { StandardView } from "@archvision/three-engine";

/**
 * Estado del editor.
 *
 * Reglas que sostienen todo el modulo:
 *  - la unica via de mutacion de la escena es `dispatch(command)`;
 *  - el historial guarda instantaneas del documento, no diferencias, porque el
 *    documento es serializable y pequeno comparado con la memoria del visor;
 *  - las habitaciones se recalculan solo tras comandos estructurales.
 */

export type ToolId =
  | "select"
  | "pan"
  | "wall"
  | "door"
  | "window"
  | "column"
  | "stair"
  | "furniture"
  | "paint"
  | "calibrate"
  | "measure";

export type ViewMode = "2d" | "3d" | "split";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

/** Conflicto de version pendiente de decision del usuario (dialogo abierto). */
export interface SceneConflictState {
  serverScene: SceneDocument;
  serverRevision: number;
}

/** Comandos que pueden cambiar los recintos cerrados. */
const STRUCTURAL_COMMANDS = new Set([
  "CREATE_WALL",
  "UPDATE_WALL",
  "DELETE_OBJECTS",
  "TRANSFORM_OBJECTS",
  "CREATE_FLOOR",
]);

const HISTORY_LIMIT = 80;

/** Muro propuesto por la deteccion, con su marca de aceptacion. */
export interface ProposedWall {
  start: Vector2;
  end: Vector2;
  thickness: number;
  length: number;
  confidence: number;
  accepted: boolean;
}

export interface MeasureState {
  start: Vector2 | null;
  end: Vector2 | null;
}

export interface ClipboardData {
  sourceFloorId: string | null;
  pasteCount: number;
  walls: Wall[];
  doors: Door[];
  windows: WindowEntity[];
  openings: Opening[];
  columns: Column[];
  stairs: Stair[];
  roofs: Roof[];
  slabs: Slab[];
  furniture: FurnitureInstance[];
}

interface EditorState {
  projectId: string;
  projectName: string;
  units: UnitSystem;

  scene: SceneDocument;
  revision: number;

  past: SceneDocument[];
  future: SceneDocument[];

  selection: string[];
  hoveredId: string | null;

  clipboard: ClipboardData | null;
  copySelection: () => void;
  pasteSelection: () => void;

  tool: ToolId;
  viewMode: ViewMode;
  activeFloorId: string | null;
  furnitureCatalogId: string;
  /** Material cargado en el pincel y arrastrado desde la biblioteca. */
  activeMaterialId: string | null;
  materialsOpen: boolean;
  /**
   * Soltar un material sobre el visor 3D. El lienzo no participa en el
   * arrastre HTML, asi que la coordenada del cursor viaja por el estado y el
   * visor resuelve contra que objeto cayo.
   */
  pendingDrop: { clientX: number; clientY: number; materialId: string } | null;

  /** Panel de importacion de planos. */
  planPanelOpen: boolean;
  /** Dos puntos marcados sobre el plano para fijar la escala. */
  calibration: MeasureState;
  /**
   * Muros propuestos por la deteccion automatica, en coordenadas del modelo.
   * Se muestran como propuesta y no se aplican hasta que el usuario acepta:
   * ninguna deteccion entra en el documento sin revision humana.
   */
  proposal: ProposedWall[] | null;

  /** Panel del asistente. */
  assistantOpen: boolean;
  /**
   * Conversacion. Vive en el store y no en el componente para que cerrar el
   * panel no borre lo hablado: se cierra para ver el modelo y se vuelve.
   */
  assistantMessages: AssistantMessage[];

  snapEnabled: boolean;
  gridStep: number;
  showGrid: boolean;

  saveStatus: SaveStatus;
  saveError: string | null;
  lastSavedAt: number | null;
  message: { kind: "error" | "info"; text: string } | null;
  /** Conflicto de version esperando al usuario; los cambios locales siguen aqui. */
  conflict: SceneConflictState | null;

  /** Solicitud de encuadre pendiente para el visor 3D. */
  pendingView: StandardView | "fit" | null;

  measure: MeasureState;
  paletteOpen: boolean;
  exportOpen: boolean;

  initialize: (payload: {
    projectId: string;
    projectName: string;
    units: UnitSystem;
    scene: SceneDocument;
    revision: number;
  }) => void;

  dispatch: (command: SceneCommand) => boolean;
  /** Aplica varios comandos como un solo paso del historial. */
  dispatchBatch: (commands: readonly SceneCommand[]) => boolean;
  undo: () => void;
  redo: () => void;

  setTool: (tool: ToolId) => void;
  setViewMode: (mode: ViewMode) => void;
  setActiveFloor: (floorId: string) => void;
  setFurnitureCatalogId: (catalogId: string) => void;
  setActiveMaterialId: (materialId: string | null) => void;
  setMaterialsOpen: (open: boolean) => void;
  requestDrop: (
    drop: { clientX: number; clientY: number; materialId: string } | null,
  ) => void;
  paintMaterial: (targetId: string) => boolean;

  setAssistantOpen: (open: boolean) => void;
  addAssistantMessages: (messages: AssistantMessage[]) => void;
  clearAssistant: () => void;

  setPlanPanelOpen: (open: boolean) => void;
  setCalibration: (calibration: MeasureState) => void;
  setProposal: (proposal: ProposedWall[] | null) => void;
  toggleProposal: (index: number) => void;
  applyProposal: () => number;
  addImportedModel: (model: Omit<ImportedModel, "id" | "source"> & { id?: string }) => void;

  select: (ids: string[], additive?: boolean) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  setHovered: (id: string | null) => void;

  setSnapEnabled: (value: boolean) => void;
  setGridStep: (value: number) => void;
  setShowGrid: (value: boolean) => void;

  requestView: (view: StandardView | "fit" | null) => void;
  setMeasure: (measure: MeasureState) => void;
  setPaletteOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;

  setSaveStatus: (status: SaveStatus) => void;
  markSaved: (revision: number) => void;
  setMessage: (message: { kind: "error" | "info"; text: string } | null) => void;
  replaceScene: (scene: SceneDocument, revision: number) => void;
  /** Abre o cierra el dialogo de conflicto de version. */
  setConflict: (conflict: SceneConflictState | null) => void;
  /** Aplica una fusion de cambios ajenos no solapados con la revision del servidor. */
  mergeScene: (scene: SceneDocument, revision: number) => void;
  /** Adopta la revision mas reciente conocida del servidor sin tocar la escena. */
  adoptRevision: (revision: number) => void;
}

const EMPTY_SCENE: SceneDocument = {
  version: SCENE_SCHEMA_VERSION,
  displayUnit: "m",
  floors: [],
  walls: [],
  doors: [],
  windows: [],
  openings: [],
  columns: [],
  stairs: [],
  roofs: [],
  slabs: [],
  rooms: [],
  furniture: [],
  importedModels: [],
  materials: [],
  lights: [],
  cameras: [],
  environment: {
    sky: "clear",
    northAngleDeg: 0,
    groundColor: "#3f4a3c",
    showGrid: true,
  },
  activeFloorId: null,
};

export const useEditorStore = create<EditorState>()((set, get) => ({
  projectId: "",
  projectName: "",
  units: "m",

  scene: EMPTY_SCENE,
  revision: 0,

  past: [],
  future: [],

  selection: [],
  hoveredId: null,

  clipboard: null,

  tool: "select",
  viewMode: "split",
  activeFloorId: null,
  furnitureCatalogId: "sofa-3-seat",
  activeMaterialId: null,
  materialsOpen: false,
  pendingDrop: null,

  planPanelOpen: false,
  calibration: { start: null, end: null },
  proposal: null,

  assistantOpen: false,
  assistantMessages: [],

  snapEnabled: true,
  gridStep: 0.1,
  showGrid: true,

  saveStatus: "saved",
  saveError: null,
  lastSavedAt: null,
  message: null,
  conflict: null,

  pendingView: null,
  measure: { start: null, end: null },
  paletteOpen: false,
  exportOpen: false,

  initialize: ({ projectId, projectName, units, scene, revision }) => {
    // La deteccion de habitaciones se ejecuta al abrir para que los proyectos
    // creados antes de esta fase muestren sus areas sin intervencion.
    const prepared = withRecomputedRooms(scene);
    set({
      projectId,
      projectName,
      units,
      scene: prepared,
      revision,
      past: [],
      future: [],
      selection: [],
      hoveredId: null,
      activeFloorId: prepared.activeFloorId ?? prepared.floors[0]?.id ?? null,
      saveStatus: "saved",
      saveError: null,
      lastSavedAt: Date.now(),
      message: null,
      conflict: null,
      measure: { start: null, end: null },
    });
  },

  dispatch: (command) => {
    const { scene, past } = get();

    try {
      const next = applyCommand(scene, command);
      const withRooms = STRUCTURAL_COMMANDS.has(command.type)
        ? withRecomputedRooms(next)
        : next;

      set({
        scene: withRooms,
        past: [...past, scene].slice(-HISTORY_LIMIT),
        future: [],
        saveStatus: "dirty",
        message: null,
        activeFloorId: withRooms.activeFloorId ?? get().activeFloorId,
      });
      return true;
    } catch (error) {
      const text =
        error instanceof CommandError
          ? error.message
          : "No fue posible aplicar el cambio";
      set({ message: { kind: "error", text } });
      return false;
    }
  },

  /**
   * Varios comandos, un solo paso de deshacer.
   *
   * Una habitacion son cuatro muros pero una sola decision: obligar a pulsar
   * Ctrl+Z cuatro veces para deshacerla seria castigar al usuario por como
   * esta implementada. Ademas es todo o nada: si un comando falla, no se
   * aplica ninguno, y la escena nunca queda a medias.
   */
  dispatchBatch: (commands) => {
    if (commands.length === 0) return false;

    const { scene, past } = get();

    try {
      let next = scene;
      for (const command of commands) next = applyCommand(next, command);

      const structural = commands.some((command) =>
        STRUCTURAL_COMMANDS.has(command.type),
      );
      const withRooms = structural ? withRecomputedRooms(next) : next;

      set({
        scene: withRooms,
        past: [...past, scene].slice(-HISTORY_LIMIT),
        future: [],
        saveStatus: "dirty",
        message: null,
        activeFloorId: withRooms.activeFloorId ?? get().activeFloorId,
      });
      return true;
    } catch (error) {
      const text =
        error instanceof CommandError
          ? error.message
          : "No fue posible aplicar los cambios";
      set({ message: { kind: "error", text } });
      return false;
    }
  },

  undo: () => {
    const { past, future, scene } = get();
    const previous = past[past.length - 1];
    if (!previous) return;

    set({
      scene: previous,
      past: past.slice(0, -1),
      future: [scene, ...future].slice(0, HISTORY_LIMIT),
      saveStatus: "dirty",
      selection: [],
    });
  },

  redo: () => {
    const { past, future, scene } = get();
    const next = future[0];
    if (!next) return;

    set({
      scene: next,
      past: [...past, scene].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      saveStatus: "dirty",
      selection: [],
    });
  },

  setTool: (tool) =>
    set({ tool, measure: { start: null, end: null }, message: null }),
  setViewMode: (viewMode) => set({ viewMode }),
  setActiveFloor: (floorId) =>
    set((state) => ({
      activeFloorId: floorId,
      scene: { ...state.scene, activeFloorId: floorId },
      selection: [],
    })),
  setFurnitureCatalogId: (furnitureCatalogId) => set({ furnitureCatalogId }),

  setActiveMaterialId: (activeMaterialId) => set({ activeMaterialId }),
  setMaterialsOpen: (materialsOpen) => set({ materialsOpen }),
  requestDrop: (pendingDrop) => set({ pendingDrop }),

  /**
   * Aplica el material cargado a una entidad.
   *
   * Vive en el store y no en cada visor porque lo usan tres caminos distintos
   * (pincel en 3D, pincel en planta y soltar desde la biblioteca) y las tres
   * deben comportarse igual, incluido el aviso cuando no hay material elegido.
   */
  paintMaterial: (targetId) => {
    const materialId = get().activeMaterialId;
    if (!materialId) {
      set({
        message: { kind: "error", text: "Elige un material en la biblioteca" },
      });
      return false;
    }
    return get().dispatch({
      type: "ASSIGN_MATERIAL",
      targetIds: [targetId],
      materialId,
    });
  },

  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
  addAssistantMessages: (messages) =>
    set((state) => ({
      assistantMessages: [...state.assistantMessages, ...messages],
    })),
  clearAssistant: () => set({ assistantMessages: [] }),

  setPlanPanelOpen: (planPanelOpen) => set({ planPanelOpen }),
  setCalibration: (calibration) => set({ calibration }),
  setProposal: (proposal) => set({ proposal }),

  toggleProposal: (index) =>
    set((state) => {
      if (!state.proposal) return {};
      return {
        proposal: state.proposal.map((wall, position) =>
          position === index ? { ...wall, accepted: !wall.accepted } : wall,
        ),
      };
    }),

  /**
   * Convierte la propuesta aceptada en muros reales.
   *
   * Se emite un comando por muro, con `origin: "import"`, de modo que la
   * operacion completa se deshace igual que cualquier otra edicion y queda
   * registrado que el trazado no lo hizo el usuario a mano.
   */
  applyProposal: () => {
    const { proposal, activeFloorId, dispatch } = get();
    if (!proposal || !activeFloorId) return 0;

    let created = 0;
    for (const wall of proposal) {
      if (!wall.accepted) continue;
      const ok = dispatch({
        type: "CREATE_WALL",
        origin: "import",
        floorId: activeFloorId,
        start: wall.start,
        end: wall.end,
        thickness: wall.thickness,
      });
      if (ok) created += 1;
    }

    set({ proposal: null });
    return created;
  },

  addImportedModel: (model) => {
    const { activeFloorId, dispatch, scene } = get();
    const floorId = model.floorId || activeFloorId || scene.floors[0]?.id;
    if (!floorId) {
      set({ message: { kind: "error", text: "No hay un nivel activo para importar el modelo" } });
      return;
    }
    dispatch({
      type: "CREATE_IMPORTED_MODEL",
      origin: "import",
      floorId,
      fileId: model.fileId,
      name: model.name,
      url: model.url,
      position: model.position,
      rotation: model.rotation,
      scale: model.scale,
    });
  },

  select: (ids, additive = false) =>
    set((state) => ({
      selection: additive
        ? Array.from(new Set([...state.selection, ...ids]))
        : ids,
    })),

  toggleSelection: (id) =>
    set((state) => ({
      selection: state.selection.includes(id)
        ? state.selection.filter((item) => item !== id)
        : [...state.selection, id],
    })),

  clearSelection: () => set({ selection: [] }),
  setHovered: (hoveredId) => set({ hoveredId }),

  copySelection: () => {
    const { scene, selection } = get();
    if (selection.length === 0) return;

    const selectedSet = new Set(selection);

    const selectedRooms = scene.rooms.filter((room) => selectedSet.has(room.id));
    for (const room of selectedRooms) {
      for (const wallId of room.wallIds) {
        selectedSet.add(wallId);
      }
    }

    const selectedWalls = scene.walls.filter((w) => selectedSet.has(w.id));
    const wallIdsSet = new Set(selectedWalls.map((w) => w.id));

    const selectedDoors = scene.doors.filter(
      (d) => selectedSet.has(d.id) || wallIdsSet.has(d.wallId),
    );
    const selectedWindows = scene.windows.filter(
      (w) => selectedSet.has(w.id) || wallIdsSet.has(w.wallId),
    );
    const selectedOpenings = scene.openings.filter(
      (o) => selectedSet.has(o.id) || wallIdsSet.has(o.wallId),
    );

    const selectedColumns = scene.columns.filter((c) => selectedSet.has(c.id));
    const selectedStairs = scene.stairs.filter((s) => selectedSet.has(s.id));
    const selectedRoofs = scene.roofs.filter((r) => selectedSet.has(r.id));
    const selectedSlabs = scene.slabs.filter((s) => selectedSet.has(s.id));
    const selectedFurniture = scene.furniture.filter((f) => selectedSet.has(f.id));

    const totalItems =
      selectedWalls.length +
      selectedDoors.length +
      selectedWindows.length +
      selectedOpenings.length +
      selectedColumns.length +
      selectedStairs.length +
      selectedRoofs.length +
      selectedSlabs.length +
      selectedFurniture.length;

    if (totalItems === 0) return;

    const sourceFloorId =
      selectedWalls[0]?.floorId ??
      selectedColumns[0]?.floorId ??
      selectedStairs[0]?.floorId ??
      selectedRoofs[0]?.floorId ??
      selectedSlabs[0]?.floorId ??
      selectedFurniture[0]?.floorId ??
      get().activeFloorId;

    set({
      clipboard: {
        sourceFloorId,
        pasteCount: 0,
        walls: JSON.parse(JSON.stringify(selectedWalls)),
        doors: JSON.parse(JSON.stringify(selectedDoors)),
        windows: JSON.parse(JSON.stringify(selectedWindows)),
        openings: JSON.parse(JSON.stringify(selectedOpenings)),
        columns: JSON.parse(JSON.stringify(selectedColumns)),
        stairs: JSON.parse(JSON.stringify(selectedStairs)),
        roofs: JSON.parse(JSON.stringify(selectedRoofs)),
        slabs: JSON.parse(JSON.stringify(selectedSlabs)),
        furniture: JSON.parse(JSON.stringify(selectedFurniture)),
      },
      message: { kind: "info", text: `${totalItems} elemento(s) copiado(s)` },
    });
  },

  pasteSelection: () => {
    const { clipboard, activeFloorId, scene, past } = get();
    if (!clipboard) return;

    const targetFloorId = activeFloorId ?? scene.floors[0]?.id;
    if (!targetFloorId) {
      set({ message: { kind: "error", text: "No hay un nivel activo para pegar" } });
      return;
    }

    const isDifferentFloor = targetFloorId !== clipboard.sourceFloorId;
    const stepCount = isDifferentFloor ? clipboard.pasteCount : clipboard.pasteCount + 1;
    const dx = stepCount * 1.0;
    const dy = stepCount * 1.0;

    const idMap = new Map<string, string>();
    const newPastedIds: string[] = [];

    const newWalls = clipboard.walls.map((wall) => {
      const newId = createId();
      idMap.set(wall.id, newId);
      newPastedIds.push(newId);
      return {
        ...wall,
        id: newId,
        floorId: targetFloorId,
        start: { x: wall.start.x + dx, y: wall.start.y + dy },
        end: { x: wall.end.x + dx, y: wall.end.y + dy },
      };
    });

    const newDoors = clipboard.doors
      .filter((door) => idMap.has(door.wallId))
      .map((door) => {
        const newId = createId();
        idMap.set(door.id, newId);
        newPastedIds.push(newId);
        return {
          ...door,
          id: newId,
          floorId: targetFloorId,
          wallId: idMap.get(door.wallId)!,
        };
      });

    const newWindows = clipboard.windows
      .filter((win) => idMap.has(win.wallId))
      .map((win) => {
        const newId = createId();
        idMap.set(win.id, newId);
        newPastedIds.push(newId);
        return {
          ...win,
          id: newId,
          floorId: targetFloorId,
          wallId: idMap.get(win.wallId)!,
        };
      });

    const newOpenings = clipboard.openings
      .filter((op) => idMap.has(op.wallId))
      .map((op) => {
        const newId = createId();
        idMap.set(op.id, newId);
        newPastedIds.push(newId);
        return {
          ...op,
          id: newId,
          floorId: targetFloorId,
          wallId: idMap.get(op.wallId)!,
        };
      });

    const newColumns = clipboard.columns.map((col) => {
      const newId = createId();
      idMap.set(col.id, newId);
      newPastedIds.push(newId);
      return {
        ...col,
        id: newId,
        floorId: targetFloorId,
        position: { x: col.position.x + dx, y: col.position.y + dy },
      };
    });

    const newStairs = clipboard.stairs.map((stair) => {
      const newId = createId();
      idMap.set(stair.id, newId);
      newPastedIds.push(newId);
      return {
        ...stair,
        id: newId,
        floorId: targetFloorId,
        position: { x: stair.position.x + dx, y: stair.position.y + dy },
      };
    });

    const newRoofs = clipboard.roofs.map((roof) => {
      const newId = createId();
      idMap.set(roof.id, newId);
      newPastedIds.push(newId);
      return {
        ...roof,
        id: newId,
        floorId: targetFloorId,
        outline: roof.outline.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
        position: roof.position
          ? { x: roof.position.x + dx, y: roof.position.y + dy }
          : undefined,
      };
    });

    const newSlabs = clipboard.slabs.map((slab) => {
      const newId = createId();
      idMap.set(slab.id, newId);
      newPastedIds.push(newId);
      return {
        ...slab,
        id: newId,
        floorId: targetFloorId,
        outline: slab.outline.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
      };
    });

    const newFurniture = clipboard.furniture.map((furn) => {
      const newId = createId();
      idMap.set(furn.id, newId);
      newPastedIds.push(newId);
      return {
        ...furn,
        id: newId,
        floorId: targetFloorId,
        position: {
          x: furn.position.x + dx,
          y: furn.position.y,
          z: furn.position.z + dy,
        },
      };
    });

    if (newPastedIds.length === 0) return;

    const nextScene: SceneDocument = {
      ...scene,
      walls: [...scene.walls, ...newWalls],
      doors: [...scene.doors, ...newDoors],
      windows: [...scene.windows, ...newWindows],
      openings: [...scene.openings, ...newOpenings],
      columns: [...scene.columns, ...newColumns],
      stairs: [...scene.stairs, ...newStairs],
      roofs: [...scene.roofs, ...newRoofs],
      slabs: [...scene.slabs, ...newSlabs],
      furniture: [...scene.furniture, ...newFurniture],
    };

    const withRooms = newWalls.length > 0 ? withRecomputedRooms(nextScene) : nextScene;

    set({
      scene: withRooms,
      past: [...past, scene].slice(-HISTORY_LIMIT),
      future: [],
      saveStatus: "dirty",
      selection: newPastedIds,
      clipboard: {
        ...clipboard,
        pasteCount: clipboard.pasteCount + 1,
      },
      message: {
        kind: "info",
        text: `${newPastedIds.length} elemento(s) pegado(s)`,
      },
    });
  },

  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setGridStep: (gridStep) => set({ gridStep }),
  setShowGrid: (showGrid) => set({ showGrid }),

  requestView: (pendingView) => set({ pendingView }),
  setMeasure: (measure) => set({ measure }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setExportOpen: (exportOpen) => set({ exportOpen }),

  setSaveStatus: (saveStatus) => set({ saveStatus }),
  markSaved: (revision) =>
    set({
      revision,
      saveStatus: "saved",
      saveError: null,
      lastSavedAt: Date.now(),
    }),
  setMessage: (message) => set({ message }),
  replaceScene: (scene, revision) =>
    set({
      scene: withRecomputedRooms(scene),
      revision,
      past: [],
      future: [],
      selection: [],
      saveStatus: "saved",
      saveError: null,
      lastSavedAt: Date.now(),
      conflict: null,
    }),
  setConflict: (conflict) => set({ conflict }),
  mergeScene: (scene, revision) =>
    set((state) => ({
      scene: withRecomputedRooms(scene),
      revision,
      past: [...state.past, state.scene].slice(-HISTORY_LIMIT),
      future: [],
      selection: [],
      saveStatus: "dirty",
      saveError: null,
      conflict: null,
    })),
  adoptRevision: (revision) =>
    set((state) => ({ revision: Math.max(state.revision, revision) })),
}));

export function hasUnsavedChanges(state: { saveStatus: SaveStatus }): boolean {
  return state.saveStatus !== "saved";
}

/** Nivel activo resuelto, con reserva al primero disponible. */
export function useActiveFloor() {
  return useEditorStore((state) => {
    const id = state.activeFloorId ?? state.scene.floors[0]?.id ?? null;
    return state.scene.floors.find((floor) => floor.id === id) ?? null;
  });
}

/** Comprueba si el historial permite deshacer o rehacer. */
export function useHistoryFlags() {
  const canUndo = useEditorStore((state) => state.past.length > 0);
  const canRedo = useEditorStore((state) => state.future.length > 0);
  return { canUndo, canRedo };
}
