"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MathUtils, Vector3, type DirectionalLight } from "three";

const DISTANCE = 100;
const SUN_COLOR = "#fff4e0";
const SUN_INTENSITY = 3.0;
const DEG_TO_RAD = Math.PI / 180;
const SHADOW_ANGLE_THRESHOLD = MathUtils.degToRad(0.5);

export interface SunLightProps {
  /** Azimut en grados, base norte (0 = N, 90 = E, 180 = S). */
  azimuth: number;
  /** Altura sobre el horizonte en grados (negativa de noche). */
  altitude: number;
}

export function SunLight({ azimuth, altitude }: SunLightProps) {
  const gl = useThree((state) => state.gl);
  const lightRef = useRef<DirectionalLight>(null);
  const lastDirection = useRef(new Vector3(0, 1, 0));

  useEffect(() => {
    const previous = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = previous;
    };
  }, [gl]);

  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;

    // NOTA: conversión válida hemisferio norte.
    // Para hemisferio sur revisar signo de theta.
    // Latitud hardcodeada: 4.6097 (Bogotá).
    // Norte alineado con -Z world. Sin corrección de northAngle.
    const phi = Math.PI / 2 - altitude * DEG_TO_RAD;
    const theta = Math.PI - azimuth * DEG_TO_RAD;
    light.position.setFromSphericalCoords(DISTANCE, phi, theta);
    light.intensity = altitude > 0 ? SUN_INTENSITY : 0;

    const last = lastDirection.current;
    const cosAngle = Math.min(
      1,
      Math.max(-1, light.position.dot(last) / DISTANCE),
    );
    if (Math.acos(cosAngle) > SHADOW_ANGLE_THRESHOLD) {
      last.copy(light.position).normalize();
      gl.shadowMap.needsUpdate = true;
    }
  });

  return (
    <directionalLight
      ref={lightRef}
      castShadow
      color={SUN_COLOR}
      intensity={SUN_INTENSITY}
      shadow-mapSize={[2048, 2048]}
    >
      <orthographicCamera
        attach="shadow-camera"
        args={[-50, 50, 50, -50, 0.5, 500]}
      />
    </directionalLight>
  );
}
