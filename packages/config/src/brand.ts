/**
 * Identidad de marca del producto.
 *
 * Punto unico de cambio de nombre: modificar aqui (o via
 * NEXT_PUBLIC_APP_NAME) renombra la aplicacion completa.
 */
export interface BrandConfig {
  /** Nombre comercial mostrado en UI. */
  readonly name: string;
  /** Nombre corto para espacios reducidos (logo colapsado, mobile). */
  readonly shortName: string;
  /** Claim principal de la landing. */
  readonly tagline: string;
  /** Subtitulo del hero. */
  readonly subtitle: string;
  /** Nombre legal de la empresa (footer, terminos). */
  readonly company: string;
  /** Correo de soporte. */
  readonly supportEmail: string;
  /** Ano de inicio para el copyright. */
  readonly foundedYear: number;
}

const envName =
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_APP_NAME : undefined;

export const brand: BrandConfig = {
  name: envName && envName.trim().length > 0 ? envName : "ArchVision 3D AI",
  shortName: "ArchVision",
  tagline: "Convierte imagenes y planos en modelos 3D editables.",
  subtitle:
    "Diseña, reconstruye y visualiza viviendas con inteligencia artificial desde tu navegador.",
  company: "ArchVision 3D AI",
  supportEmail: "soporte@archvision.app",
  foundedYear: 2026,
};
