"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import {
  SITE_LAT,
  SITE_LNG,
  SUN_LAPSE_HOURS_PER_SECOND,
  SunLight,
  sunPositionFor,
  toSunDate,
  useSunStudyStore,
} from "@archvision/three-engine";

const SECONDS_PER_HOUR = 1 / SUN_LAPSE_HOURS_PER_SECOND;

export function SunSky() {
  const sunTime = useSunStudyStore((state) => state.sunTime);
  const isLapsePlaying = useSunStudyStore((state) => state.isLapsePlaying);
  const lapseAccumulator = useRef(0);

  useFrame((_, delta) => {
    if (!isLapsePlaying) {
      lapseAccumulator.current = 0;
      return;
    }
    lapseAccumulator.current += delta;
    while (lapseAccumulator.current >= SECONDS_PER_HOUR) {
      lapseAccumulator.current -= SECONDS_PER_HOUR;
      const state = useSunStudyStore.getState();
      state.setSunTime((state.sunTime + 1) % 24);
    }
  });

  const { azimuth, altitude, direction } = sunPositionFor({
    latitude: SITE_LAT,
    longitude: SITE_LNG,
    date: toSunDate(sunTime),
  });

  return (
    <>
      <SunLight azimuth={azimuth} altitude={altitude} />
      <Sky sunPosition={direction} />
    </>
  );
}
