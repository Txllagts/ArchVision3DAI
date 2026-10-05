import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Contrato uniforme de respuesta de la API.
 *
 * Exito:  { data: T }
 * Error:  { error: { code, message, details? } }
 *
 * Ningun handler devuelve mensajes de excepcion crudos al cliente: se
 * registran en el servidor y se responde con un codigo estable.
 */

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "SERVICE_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 402,
  SERVICE_UNAVAILABLE: 503,
  UPSTREAM_ERROR: 502,
  UPSTREAM_TIMEOUT: 504,
  INTERNAL: 500,
};

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status: STATUS_BY_CODE[code] },
  );
}

/** Traduce un ZodError a la forma de error de la API. */
export function apiValidationError(error: ZodError): NextResponse {
  const details = error.issues.map((issue) => ({
    field: issue.path.join(".") || "(raiz)",
    message: issue.message,
  }));
  return apiError("BAD_REQUEST", "Datos invalidos", details);
}

/**
 * Envoltura de handlers: captura errores no previstos, los registra con
 * contexto y responde 500 sin filtrar detalles internos.
 */
export async function withErrorHandling(
  scope: string,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ZodError) return apiValidationError(error);
    console.error(`[api:${scope}]`, error);
    return apiError("INTERNAL", "Error interno del servidor");
  }
}

/** Lee y parsea el cuerpo JSON con limite de tamano. */
export async function readJsonBody(
  request: Request,
  maxBytes = 5 * 1024 * 1024,
): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) {
    throw new PayloadTooLargeError();
  }

  const text = await request.text();
  if (text.length > maxBytes) throw new PayloadTooLargeError();
  if (text.trim().length === 0) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidJsonError();
  }
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Cuerpo de la peticion demasiado grande");
    this.name = "PayloadTooLargeError";
  }
}

export class InvalidJsonError extends Error {
  constructor() {
    super("JSON invalido");
    this.name = "InvalidJsonError";
  }
}
