"use client";

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type RefObject,
  type ReactNode,
} from "react";
import { Bounds, Center, Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import type { Object3D } from "three";
import { Vector3 } from "three";

function LoadedModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const model = useMemo<Object3D>(() => scene.clone(true), [scene]);
  return <primitive object={model} />;
}

type ViewAction = "reset" | "rotate" | "front" | "back";

interface ViewCommand {
  action: ViewAction;
  sequence: number;
}

type ControlsInstance = ComponentRef<typeof OrbitControls>;

function ApplyViewCommand({
  controlsRef,
  command,
}: {
  controlsRef: RefObject<ControlsInstance | null>;
  command: ViewCommand | null;
}) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !command) return;

    const target = controls.target;
    const distance = Math.max(camera.position.distanceTo(target), 1);
    if (command.action === "reset") {
      target.set(0, 0, 0);
      camera.position.set(distance * 0.55, distance * 0.35, distance * 0.75);
      camera.up.set(0, 1, 0);
    } else if (command.action === "rotate") {
      camera.position
        .sub(target)
        .applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
        .add(target);
    } else {
      target.set(0, 0, 0);
      camera.position.set(
        0,
        distance * 0.15,
        command.action === "front" ? distance : -distance,
      );
      camera.up.set(0, 1, 0);
    }
    controls.update();
  }, [camera, command, controlsRef]);

  return null;
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
  const controlsRef = useRef<ControlsInstance | null>(null);
  const [command, setCommand] = useState<ViewCommand | null>(null);

  function applyView(action: ViewAction) {
    setCommand((current) => ({
      action,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  }

  return (
    <ModelPreviewBoundary>
      <div className="relative h-72 overflow-hidden rounded-lg">
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
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableRotate
            enableZoom
            minPolarAngle={0}
            maxPolarAngle={Math.PI}
            minDistance={0.2}
            maxDistance={100}
          />
          <ApplyViewCommand controlsRef={controlsRef} command={command} />
        </Canvas>
        <div
          aria-label="Controles de inspección del modelo"
          className="absolute inset-x-2 bottom-2 flex flex-wrap justify-center gap-1.5"
        >
          {(
            [
              ["reset", "Restablecer vista"],
              ["rotate", "Rotar 90°"],
              ["front", "Frontal"],
              ["back", "Trasera"],
            ] as const
          ).map(([action, label]) => (
            <button
              key={action}
              type="button"
              onClick={() => applyView(action)}
              className="rounded-md border border-white/15 bg-black/65 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm backdrop-blur transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </ModelPreviewBoundary>
  );
}
