export const ROTATION_STEP_STORAGE_KEY = "archvision.rotation-step-degrees";

export function readRotationStepDegrees(): number {
  if (typeof window === "undefined") return 90;
  try {
    const value = Number(window.localStorage.getItem(ROTATION_STEP_STORAGE_KEY));
    return Number.isFinite(value) && value >= 1 && value <= 360 ? value : 90;
  } catch {
    return 90;
  }
}

export function writeRotationStepDegrees(value: string): void {
  const degrees = Number(value);
  if (!Number.isFinite(degrees) || degrees < 1 || degrees > 360) return;
  try {
    window.localStorage.setItem(ROTATION_STEP_STORAGE_KEY, String(degrees));
  } catch {
    // El giro sigue disponible si el navegador bloquea el almacenamiento local.
  }
}
