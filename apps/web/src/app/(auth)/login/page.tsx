import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { Panel } from "@/components/ui/surface";
import { redirectIfAuthenticated } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  await redirectIfAuthenticated();

  return (
    <Panel className="p-6">
      <h1 className="text-lg font-semibold tracking-tight">Iniciar sesión</h1>
      <p className="mt-1 mb-5 text-xs text-ink-muted">
        Accede a tus proyectos y al editor 3D.
      </p>

      <AuthForm mode="login" />

      <p className="mt-5 text-xs text-ink-muted">
        ¿No tienes cuenta?{" "}
        <Link href="/register" className="text-accent hover:underline">
          Crear cuenta
        </Link>
      </p>
      <p className="mt-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-[11px] text-ink-subtle">
        Demostración: demo@archvision.app / arquitectura2026
      </p>
    </Panel>
  );
}
