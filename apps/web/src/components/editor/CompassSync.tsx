"use client";

import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Vector3 } from "three";

interface OrbitLike {
  target: Vector3;
  setAzimuthalAngle: (angle: number) => void;
  update: () => void;
}

export function CompassSync() {
  const controls = useThree((state) => state.controls) as OrbitLike | null;

  useFrame(({ camera }) => {
    if (!controls) return;
    const dir = camera.position.clone().sub(controls.target);
    const azimuth = Math.atan2(dir.x, dir.z);
    const container = document.getElementById("editor-root");
    container?.style.setProperty("--compass-angle", `${azimuth}rad`);
  });

  useEffect(() => {
    const handler = () => {
      if (controls) {
        controls.setAzimuthalAngle(0);
        controls.update();
      }
    };
    window.addEventListener("reset-compass", handler);
    return () => window.removeEventListener("reset-compass", handler);
  }, [controls]);

  return null;
}
