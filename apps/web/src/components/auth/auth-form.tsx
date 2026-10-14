"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { loginSchema, registerSchema } from "@archvision/validation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";

/**
 * Formularios de acceso.
 *
 * La validacion usa los mismos esquemas Zod que la API: el cliente da
 * feedback inmediato y el servidor sigue siendo la autoridad.
 */

type Mode = "login" | "register";

interface ApiErrorShape {
  error?: { message?: string; details?: Array<{ field: string; message: string }> };
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const raw = Object.fromEntries(formData.entries());

    const schema = mode === "login" ? loginSchema : registerSchema;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiErrorShape;
        const details = payload.error?.details;
        if (details?.length) {
          const errors: Record<string, string> = {};
          for (const detail of details) errors[detail.field] = detail.message;
          setFieldErrors(errors);
        }
        setFormError(payload.error?.message ?? "No fue posible completar la operacion");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setFormError("No hay conexion con el servidor. Reintenta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {mode === "register" ? (
        <TextField
          label="Nombre"
          name="name"
          autoComplete="name"
          placeholder="Ana Restrepo"
          required
          error={fieldErrors.name}
        />
      ) : null}

      <TextField
        label="Correo"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="tucorreo@estudio.com"
        required
        error={fieldErrors.email}
      />

      <TextField
        label="Contraseña"
        name="password"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        placeholder="********"
        required
        hint={mode === "register" ? "Mínimo 10 caracteres, con letras y números" : undefined}
        error={fieldErrors.password}
      />

      {formError ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {formError}
        </p>
      ) : null}

      <Button type="submit" className="w-full justify-center" loading={loading}>
        {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
      </Button>
    </form>
  );
}
