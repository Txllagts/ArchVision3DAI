import { z } from "zod";

/** Esquemas de autenticacion. Reutilizados por formularios y rutas de API. */

export const emailSchema = z
  .string()
  .trim()
  .min(5, "Correo demasiado corto")
  .max(254, "Correo demasiado largo")
  .email("Correo invalido")
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(10, "La contraseña debe tener al menos 10 caracteres")
  .max(200, "La contraseña es demasiado larga")
  .refine((value) => /[a-zA-Z]/.test(value), {
    message: "La contraseña debe incluir al menos una letra",
  })
  .refine((value) => /\d/.test(value), {
    message: "La contraseña debe incluir al menos un número",
  });

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Nombre demasiado corto").max(80),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Introduce tu contraseña").max(200),
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
