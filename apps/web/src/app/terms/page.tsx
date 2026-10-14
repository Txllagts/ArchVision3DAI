import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { TermsContent } from "@/components/legal/terms-content";
import { Panel } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Términos y Condiciones del Servicio",
  description:
    "Términos y condiciones de la plataforma SaaS ArchVision 3D AI conforme a la legislación de Colombia.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-canvas py-10 px-4 md:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" />
              Volver al inicio
            </Button>
          </Link>
        </div>

        <Panel className="p-6 md:p-10">
          <div className="mb-6 border-b border-line pb-4">
            <h1 className="text-2xl font-bold tracking-tight text-ink font-display">
              Términos y Condiciones del Servicio
            </h1>
            <p className="mt-1 text-xs text-ink-subtle">
              ArchVision 3D AI · Plataforma de Software como Servicio (SaaS) en Colombia
            </p>
          </div>

          <TermsContent />
        </Panel>

        <footer className="text-center text-xs text-ink-subtle pb-6">
          <p>
            ArchVision 3D AI · Para inquietudes o ejercicio de derechos de Habeas Data (Ley 1581), contáctanos en{" "}
            <a href="mailto:soporte@archvision.app" className="text-accent underline">
              soporte@archvision.app
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
