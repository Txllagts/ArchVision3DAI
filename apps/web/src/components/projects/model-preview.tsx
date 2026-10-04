"use client";

import { Component, Suspense, useMemo, type ReactNode } from "react";
import { Bounds, Center, Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { Object3D } from "three";

function LoadedModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const model = useMemo<Object3D>(() => scene.clone(true), [scene]);
  return <primitive object={model} />;
}

class ModelPreviewBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: Error) {
    console.error("[model-preview] no se pudo cargar el GLB", error);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex h-72 items-center justify-center px-4 text-center text-xs text-ink-subtle"
        >
          No se pudo cargar la vista previa. Puedes abrir o descargar el GLB.
        </div>
      );
    }
    return this.props.children;
  }
}

export function ModelPreview({ url }: { url: string }) {
  return (
    <ModelPreviewBoundary>
      <Canvas camera={{ position: [3, 2, 4], fov: 45 }}>
        <color attach="background" args={["#17191c"]} />
        <ambientLight intensity={1.5} />
        <directionalLight position={[4, 6, 4]} intensity={2} />
        <Suspense
          fallback={
            <Html center className="text-xs text-white">
              Cargando modelo...
            </Html>
          }
        >
          <Bounds fit clip observe margin={1.2}>
            <Center>
              <LoadedModel url={url} />
            </Center>
          </Bounds>
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
    </ModelPreviewBoundary>
  );
}
