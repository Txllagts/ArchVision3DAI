"use client";

import type { PlanUnderlay, Vector2 } from "@archvision/types";
import { pixelToWorld } from "@archvision/shared";

/**
 * Colocacion del plano importado.
 *
 * El plano vive en pixeles de imagen y el modelo en metros. Estas dos
 * funciones son la unica conversion entre ambos mundos: escala (pixeles por
 * metro), giro (para enderezar un escaneado torcido) y traslacion (para
 * apoyarlo donde el usuario quiera).
 *
 *   mundo = offset + R(rotacion) * (pixel / pixelesPorMetro)
 *
 * La formula vive en `@archvision/shared` (`pixelToWorld`) porque la usa
 * tambien la traduccion de los analisis del servicio de IA: los muros
 * detectados deben caer sobre la misma imagen que ve el usuario.
 */

export function imageToWorld(underlay: PlanUnderlay, pixel: Vector2): Vector2 {
  return pixelToWorld([pixel.x, pixel.y], underlay);
}

export function worldToImage(underlay: PlanUnderlay, world: Vector2): Vector2 {
  const angle = (underlay.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const dx = world.x - underlay.offset.x;
  const dy = world.y - underlay.offset.y;

  return {
    x: (dx * cos + dy * sin) * underlay.pixelsPerMeter,
    y: (-dx * sin + dy * cos) * underlay.pixelsPerMeter,
  };
}

/**
 * Recalcula la escala a partir de una medida conocida.
 *
 * El primer punto marcado queda anclado: cambiar la escala alrededor de el
 * evita que el plano salte por la pantalla justo cuando el usuario acaba de
 * situarlo.
 */
export function recalibrate(
  underlay: PlanUnderlay,
  from: Vector2,
  to: Vector2,
  realLengthMeters: number,
): PlanUnderlay {
  const a = worldToImage(underlay, from);
  const b = worldToImage(underlay, to);
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);

  if (pixels < 1) throw new Error("Marca dos puntos separados sobre el plano");
  if (!(realLengthMeters > 0)) throw new Error("La medida debe ser mayor que cero");

  const pixelsPerMeter = pixels / realLengthMeters;
  const candidate: PlanUnderlay = { ...underlay, pixelsPerMeter };

  // Se recoloca el origen para que el punto `from` siga cayendo donde estaba.
  const moved = imageToWorld(candidate, a);
  return {
    ...candidate,
    offset: {
      x: candidate.offset.x + (from.x - moved.x),
      y: candidate.offset.y + (from.y - moved.y),
    },
  };
}

/**
 * Carga la imagen del plano y devuelve sus pixeles.
 *
 * El analisis ocurre en el navegador: la imagen ya esta descargada para
 * mostrarla de fondo, el servidor se ahorra el trabajo y los pixeles no viajan
 * dos veces por la red.
 */
export async function loadImageData(url: string): Promise<ImageData> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("No se pudo descargar el plano");

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("El navegador no permite leer la imagen");

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  return context.getImageData(0, 0, canvas.width, canvas.height);
}
