import type { Camera, Scene, WebGLRenderer } from "three";

/**
 * Acceso al visor 3D activo fuera del arbol React.
 *
 * El visor solo es alcanzable con `useThree()` dentro del `Canvas`, y el
 * store guarda el `SceneDocument` (JSON), no la escena de Three.js. El
 * componente `ActiveSceneHandle` registra aqui el paquete completo
 * (escena + camara + renderer) mientras el visor esta montado: los
 * exportadores de malla clonan la escena y la captura PNG lee el canvas.
 */
export interface ActiveViewport {
  scene: Scene;
  camera: Camera;
  gl: WebGLRenderer;
}

let activeViewport: ActiveViewport | null = null;

export function setActiveViewport(viewport: ActiveViewport | null): void {
  activeViewport = viewport;
}

export function getActiveViewport(): ActiveViewport | null {
  return activeViewport;
}
