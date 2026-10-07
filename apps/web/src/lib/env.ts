import { z } from "zod";

/**
 * Validacion de variables de entorno del servidor.
 *
 * Se ejecuta al arrancar: si falta una variable critica el proceso falla
 * temprano y con un mensaje claro, en lugar de romperse en produccion.
 */
const emptyToUndefined = (val: unknown) =>
  typeof val === "string" && val.trim() === "" ? undefined : val;

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET debe tener al menos 32 caracteres"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  AI_SERVICE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  AI_SERVICE_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AI_MODE: z.enum(["mock", "live"]).default("mock"),
  /**
   * Motor del asistente. `local` resuelve con reglas dentro del proceso y no
   * necesita clave ni conexion; `claude` delega en el modelo de lenguaje
   * cuando las reglas no encuentran respuesta. Si falta la clave, `claude`
   * degrada a `local` en vez de fallar: el asistente nunca deja de funcionar.
   */
  ASSISTANT_PROVIDER: z.enum(["local", "claude"]).default("local"),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ASSISTANT_MODEL: z.string().min(1).default("claude-opus-5"),

  /**
   * Facturacion. `manual` simula los cobros y solo funciona fuera de
   * produccion; `wompi` cobra de verdad y exige las cuatro claves.
   */
  BILLING_PROVIDER: z.enum(["manual", "wompi"]).default("manual"),
  WOMPI_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  WOMPI_PUBLIC_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  WOMPI_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Firma el importe del checkout para que nadie lo altere en la URL. */
  WOMPI_INTEGRITY_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Verifica los eventos que Wompi envia al webhook. */
  WOMPI_EVENTS_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Autoriza la ejecucion del cobro de renovaciones desde un programador. */
  BILLING_CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Configuracion de entorno invalida:\n${details}\n\nRevisa el archivo .env en la raiz del monorepo (usa .env.example como plantilla).`,
    );
  }

  cached = parsed.data;
  return cached;
}

export const isProduction = (): boolean => getEnv().NODE_ENV === "production";
