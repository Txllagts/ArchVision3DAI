"use client";

import { Environment } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO } from "@react-three/postprocessing";

export interface SceneEnvironmentProps {
  /** Preset de cielo de drei (p. ej. "sunset"). */
  preset?: string;
  /** Intensidad de la iluminacion de entorno (entorno solar). */
  exposure?: number;
}

/**
 * Entorno visual de la escena: iluminacion IBL, sombras suaves y postproceso.
 * No toca la escena parametrica: solo afecta a como se dibuja.
 */
export function SceneEnvironment({
  preset = "sunset",
  exposure = 1,
}: SceneEnvironmentProps) {
  return (
    <>
      <Environment
        preset={preset as never}
        background={false}
        environmentIntensity={exposure}
      />
      {
        // SoftShadows eliminado: colisiona con Fast Refresh.
        // Shader Error 0 - function already has a body.
        // No reintroducir sin solución que evite chunks globales.
      }
      <EffectComposer multisampling={4} autoClear={false}>
        <N8AO
          halfRes
          aoRadius={0.5}
          intensity={2.0}
          aoSamples={4}
          denoiseSamples={4}
          color="black"
        />
        <Bloom
          luminanceThreshold={1.5}
          luminanceSmoothing={0.1}
          intensity={0.3}
        />
      </EffectComposer>
    </>
  );
}
