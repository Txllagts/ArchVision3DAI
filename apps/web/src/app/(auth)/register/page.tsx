import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { Panel } from "@/components/ui/surface";
import { redirectIfAuthenticated } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function RegisterPage() {
  await redirectIfAuthenticated();

  return (
    <Panel className="p-6">
      <h1 className="text-lg font-semibold tracking-tight">Crear cuenta</h1>
      <p className="mt-1 mb-5 text-xs text-ink-muted">
        Se creará tu espacio de trabajo personal automáticamente.
      </p>

      <AuthForm mode="register" />

      <p className="mt-5 text-xs text-ink-muted">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Iniciar sesión
        </Link>
      </p>
    </Panel>
  );
}
