import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Scene,
  type Object3D,
} from "three";
import { prepareSceneForExport } from "./scene-prep";
import type { ExportOptions } from "./types";

function options(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    format: "glb",
    unit: "m",
    includeFurniture: true,
    includeMaterials: true,
    ...overrides,
  };
}

/**
 * Escena minima que replica la estructura del visor: ayudas de raiz sin
 * entidad (luces y plano de trabajo), un grupo de entidad con contorno de
 * seleccion y un mueble con la bandera `furniture`.
 */
function buildSource() {
  const scene = new Scene();

  const light = new PointLight(0xffffff, 1);
  scene.add(light);

  const workPlane = new Mesh(
    new PlaneGeometry(10, 10),
    new MeshStandardMaterial({ name: "plano-trabajo" }),
  );
  scene.add(workPlane);

  const floor = new Group();

  const wallMaterial = new MeshStandardMaterial({
    name: "Ladrillo rojo",
    color: 0xaa4422,
  });
  const wall = new Mesh(new BoxGeometry(3.75, 2.6, 0.2), wallMaterial);
  wall.userData = { entityId: "wall-1" };
  const outline = new LineSegments(new BufferGeometry(), new LineBasicMaterial());
  outline.name = "contorno-seleccion";
  wall.add(outline);

  const chair = new Mesh(
    new BoxGeometry(0.5, 0.9, 0.5),
    new MeshStandardMaterial({ name: "Madera", color: 0x886644 }),
  );
  chair.userData = { entityId: "furn-1", furniture: true };

  floor.add(wall, chair);
  scene.add(floor);

  return { scene, light, workPlane, wall, wallMaterial, outline };
}

function collect(root: Object3D, predicate: (object: Object3D) => boolean): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((object) => {
    if (predicate(object)) found.push(object);
  });
  return found;
}

function meshById(root: Object3D, id: string): Mesh | undefined {
  return collect(
    root,
    (object) => object.userData.entityId === id && (object as Mesh).isMesh,
  )[0] as Mesh | undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("prepareSceneForExport", () => {
  it("elimina las ayudas del editor (luces, plano de trabajo y contornos)", () => {
    const { scene } = buildSource();
    const prepared = prepareSceneForExport(scene, options());

    // Solo sobrevive el grupo de entidades: la luz y el plano de trabajo son
    // hijos de raiz sin userData.entityId.
    expect(prepared.root.children).toHaveLength(1);

    const lights = collect(
      prepared.root,
      (object) => (object as { isLight?: boolean }).isLight === true,
    );
    expect(lights).toHaveLength(0);

    const planes = collect(
      prepared.root,
      (object) => (object as Mesh).isMesh && object.name === "",
    );
    expect(planes).toHaveLength(0);

    // Los contornos de seleccion (lineas de drei Edges) se descartan tambien.
    const lines = collect(
      prepared.root,
      (object) =>
        (object as { isLine?: boolean }).isLine === true ||
        (object as { isLineSegments?: boolean }).isLineSegments === true,
    );
    expect(lines).toHaveLength(0);
    expect(meshById(prepared.root, "wall-1")).toBeDefined();
  });

  it("excluye el mobiliario cuando includeFurniture es false", () => {
    const { scene } = buildSource();
    const prepared = prepareSceneForExport(
      scene,
      options({ includeFurniture: false }),
    );

    expect(meshById(prepared.root, "wall-1")).toBeDefined();
    expect(meshById(prepared.root, "furn-1")).toBeUndefined();
    const flagged = collect(prepared.root, (object) => object.userData.furniture === true);
    expect(flagged).toHaveLength(0);
  });

  it("aplica la escala de la unidad seleccionada sobre la escena en metros", () => {
    const { scene } = buildSource();

    const meters = prepareSceneForExport(scene, options({ unit: "m" }));
    expect(meters.root.scale.x).toBeCloseTo(1, 10);

    const centimeters = prepareSceneForExport(scene, options({ unit: "cm" }));
    expect(centimeters.root.scale.x).toBeCloseTo(100, 6);

    const millimeters = prepareSceneForExport(scene, options({ unit: "mm" }));
    expect(millimeters.root.scale.x).toBeCloseTo(1000, 6);
  });

  it("clona los materiales sin tocar la escena viva", () => {
    const { scene, wall, wallMaterial } = buildSource();
    const prepared = prepareSceneForExport(scene, options());

    const exportedWall = meshById(prepared.root, "wall-1");
    expect(exportedWall).toBeDefined();
    expect(exportedWall?.material).not.toBe(wallMaterial);
    expect((exportedWall?.material as Material).name).toBe("Ladrillo rojo");

    // La escena original queda intacta: mismos hijos y mismo material.
    expect(scene.children).toHaveLength(3);
    expect(wall.material).toBe(wallMaterial);
  });

  it("sustituye todos los materiales por uno neutro si includeMaterials es false", () => {
    const { scene, wall, wallMaterial } = buildSource();
    const prepared = prepareSceneForExport(
      scene,
      options({ includeMaterials: false }),
    );

    const materials = collect(
      prepared.root,
      (object) => (object as Mesh).isMesh,
    ).map((object) => (object as Mesh).material as Material);

    expect(materials.length).toBeGreaterThan(0);
    const unique = new Set(materials);
    expect(unique.size).toBe(1);
    expect([...unique][0]?.name).toBe("material");

    expect(wall.material).toBe(wallMaterial);
  });

  it("dispose libera los materiales clonados y no los compartidos", () => {
    const { scene, wallMaterial } = buildSource();
    const disposeSpy = vi.spyOn(Material.prototype, "dispose");

    const prepared = prepareSceneForExport(scene, options());
    expect(disposeSpy).not.toHaveBeenCalled();

    prepared.dispose();
    expect(disposeSpy.mock.instances.length).toBeGreaterThan(0);
    // El material vivo del editor jamas se dispone.
    expect(disposeSpy.mock.instances).not.toContain(wallMaterial);
  });
});
