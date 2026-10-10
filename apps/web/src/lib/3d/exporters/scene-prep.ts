import {
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import { fromMeters } from "@archvision/shared";
import { slugify } from "./slug";
import type { ExportOptions } from "./types";

/**
 * Escena preparada para exportar.
 *
 * `root` es un grupo nuevo listo para los exportadores de three.js, con la
 * escala de unidad aplicada. `dispose` libera unicamente los recursos que el
 * exportador CREO (materiales clonados o sustituidos): las geometrias y las
 * texturas se comparten con la escena viva y nunca se tocan.
 */
export interface PreparedScene {
  root: Group;
  dispose: () => void;
}

/**
 * Prepara una copia exportable de la escena del editor.
 *
 * Criterios de limpieza, en orden:
 *
 * 1. **Ayudas del editor**: solo se clonan los hijos de la raiz que contienen
 *    `userData.entityId` en su subarbol. Asi desaparecen las luces del
 *    entorno, la rejilla de drei, la malla gigante del plano de trabajo y la
 *    previsualizacion de pared: todas ellas son hijos de raiz sin entidad.
 * 2. **Contornos de seleccion**: dentro de lo conservado se eliminan los
 *    objetos linea (`isLine`/`isLineSegments`, incluidas las lineas gordas de
 *    drei `Edges` usadas para resaltar la seleccion).
 * 3. **Mobiliario**: si `includeFurniture` es false se eliminan los objetos con
 *    `userData.furniture === true` (bandera que pone `FurnitureObject`).
 * 4. **Materiales**: siempre se clonan (la escena viva nunca se modifica) y,
 *    si `includeMaterials` es false, se sustituyen todos por un material gris
 *    neutro compartido. Las texturas se comparten, nunca se clonan.
 * 5. **Unidad**: la escena esta en metros; el grupo raiz aplica
 *    `fromMeters(1, unit)` para que el archivo salga en m/cm/mm.
 */
export function prepareSceneForExport(
  source: Object3D,
  options: ExportOptions,
): PreparedScene {
  const root = new Group();
  root.name = "exportacion";
  root.scale.setScalar(fromMeters(1, options.unit));

  for (const child of source.children) {
    if (!containsEntity(child)) continue;
    root.add(child.clone(true));
  }

  const stale: Object3D[] = [];
  root.traverse((object) => {
    if (object !== root && isLineObject(object)) {
      stale.push(object);
      return;
    }
    if (!options.includeFurniture && object.userData.furniture === true) {
      stale.push(object);
    }
  });
  for (const object of stale) object.parent?.remove(object);

  const ownedMaterials = new Set<Material>();
  const materialClones = new Map<Material, Material>();
  const usedNames = new Set<string>();
  let objectIndex = 0;

  const neutral = options.includeMaterials
    ? null
    : new MeshStandardMaterial({
        name: "material",
        color: 0xc9c9c9,
        roughness: 0.9,
        metalness: 0,
      });
  if (neutral) ownedMaterials.add(neutral);

  const cloneMaterial = (material: Material): Material => {
    const cached = materialClones.get(material);
    if (cached) return cached;
    const clone = material.clone();
    // OBJ enlaza materiales por nombre via `usemtl`/`newmtl`: se les asigna un
    // slug unico. Los demas formatos conservan el nombre original.
    if (options.format === "obj") {
      clone.name = uniqueName(slugify(clone.name) || "material", usedNames);
    }
    materialClones.set(material, clone);
    ownedMaterials.add(clone);
    return clone;
  };

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.name) mesh.name = `objeto_${objectIndex++}`;
    if (neutral) {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(() => neutral)
        : neutral;
      return;
    }
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(cloneMaterial)
      : cloneMaterial(mesh.material);
  });

  root.updateMatrixWorld(true);

  return {
    root,
    dispose: () => {
      for (const material of ownedMaterials) material.dispose();
      ownedMaterials.clear();
      materialClones.clear();
    },
  };
}

function containsEntity(object: Object3D): boolean {
  if (typeof object.userData.entityId === "string") return true;
  let found = false;
  object.traverse((child) => {
    if (!found && typeof child.userData.entityId === "string") found = true;
  });
  return found;
}

function isLineObject(object: Object3D): boolean {
  const candidate = object as Object3D & { isLine?: boolean; isLineSegments?: boolean };
  return candidate.isLine === true || candidate.isLineSegments === true;
}

function uniqueName(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
}
