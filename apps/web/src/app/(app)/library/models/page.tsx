"use client";

import { useState } from "react";
import { Boxes, DoorOpen, LayoutGrid, Sun, Mountain, Layers, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/ui/surface";

export default function ModelsLibraryPage() {
  const [activeTab, setActiveTab] = useState<"openings" | "structure" | "environment">("openings");

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Recursos y Presets Arquitectónicos</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Catálogo de elementos paramétricos, carpinterías, estructuras y configuraciones de entorno.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-ink-muted border border-line">
          <Boxes className="size-4 text-accent" />
          <span>Librería de Componentes 3D</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line">
        <button
          onClick={() => setActiveTab("openings")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "openings"
              ? "border-accent text-accent"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          <DoorOpen className="size-4" />
          Vanos y Carpinterías
        </button>
        <button
          onClick={() => setActiveTab("structure")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "structure"
              ? "border-accent text-accent"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          <LayoutGrid className="size-4" />
          Estructura y Cubiertas
        </button>
        <button
          onClick={() => setActiveTab("environment")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "environment"
              ? "border-accent text-accent"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          <Sun className="size-4" />
          Entorno y Luces
        </button>
      </div>

      {/* Tab 1: Vanos */}
      {activeTab === "openings" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ResourceCard
            title="Puerta Batiente Estándar"
            description="Puerta de paso interior de 0.90m x 2.10m con marco de madera o aluminio."
            badge="Carpintería"
            tags={["Paso interior", "90x210 cm", "Marco 10cm"]}
          />
          <ResourceCard
            title="Puerta Doble Principal"
            description="Puerta de acceso de dos hojas de 1.80m x 2.20m con paños de vidrio."
            badge="Carpintería"
            tags={["Acceso", "180x220 cm", "Doble hoja"]}
          />
          <ResourceCard
            title="Puerta Corrediza de Vidrio"
            description="Sistema de puerta corredera de vidrio templado de 2.00m x 2.20m."
            badge="Carpintería"
            tags={["Terraza/Balcón", "Corrediza", "Vidrio templado"]}
          />
          <ResourceCard
            title="Ventana Guillotina / Fija"
            description="Ventana estándar de 1.20m x 1.20m con antepecho regulable a 1.00m."
            badge="Vano"
            tags={["Iluminación", "Antepecho 1m", "Vidrio 6mm"]}
          />
          <ResourceCard
            title="Ventana Panorámica Apaisada"
            description="Vano continuo de 2.40m x 1.00m para vistas horizontales en zonas sociales."
            badge="Vano"
            tags={["Fachada", "Apaisada", "240x100 cm"]}
          />
          <ResourceCard
            title="Tragaluz de Techo"
            description="Vano zenital inclinado para captación de luz en cubiertas de baños o corredores."
            badge="Zenital"
            tags={["Techo", "Tragaluz", "Luz cenital"]}
          />
        </div>
      )}

      {/* Tab 2: Estructura */}
      {activeTab === "structure" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ResourceCard
            title="Columna Cuadrada de Concreto"
            description="Elemento estructural vertical de 0.30m x 0.30m con altura de entrepiso."
            badge="Estructura"
            tags={["Concreto", "Soporte", "30x30 cm"]}
          />
          <ResourceCard
            title="Columna Circular de Acero"
            description="Perfil tubular de acero de 0.25m de diámetro para arquitectura expuesta."
            badge="Estructura"
            tags={["Acero", "Circular", "D=25 cm"]}
          />
          <ResourceCard
            title="Escalera Recta Unirramo"
            description="Escalera de 1.00m de ancho con huella de 0.28m y contrahuella de 0.175m."
            badge="Circulación"
            tags={["Unirramo", "100 cm ancho", "Paso regulable"]}
          />
          <ResourceCard
            title="Escalera en L con Descanso"
            description="Escalera de dos tramos a 90 grados con descanso cuadrado intermedio."
            badge="Circulación"
            tags={["90 grados", "Descanso", "Acceso nivel superiores"]}
          />
          <ResourceCard
            title="Cubierta a Dos Aguas"
            description="Techo inclinado paramétrico con faldones en ángulo y caballete central."
            badge="Cubierta"
            tags={["Dos aguas", "Inclinada", "Faldones"]}
          />
          <ResourceCard
            title="Cubierta Plana Invertida"
            description="Losa plana impermeable para terrazas transitables o cubiertas verdes."
            badge="Cubierta"
            tags={["Losa plana", "Terraza", "Aislamiento"]}
          />
        </div>
      )}

      {/* Tab 3: Entorno */}
      {activeTab === "environment" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ResourceCard
            title="Cielo Despejado y Sol Directo"
            description="Sistema de iluminación diurna con ángulo de azimuth y solsticio configurable."
            badge="Iluminación"
            tags={["Luz solar", "Sombras nítidas", "HDRI diurno"]}
          />
          <ResourceCard
            title="Cielo Nublado Difuso"
            description="Iluminación ambiental suave sin sombras duras para renderizado técnico."
            badge="Iluminación"
            tags={["Luz difusa", "Ambiente", "Sin destellos"]}
          />
          <ResourceCard
            title="Luz Focal Recesada (Downlight)"
            description="Luz puntual de techo con cono de apertura y atenuación realista."
            badge="Luminaria"
            tags={["Spotlight", "Interior", "Cálida/Fría"]}
          />
          <ResourceCard
            title="Plano de Terreno Natural"
            description="Superficie de vegetación y suelo para inserción del proyecto."
            badge="Terreno"
            tags={["Grama", "Verde oliva", "Extensión 50m"]}
          />
        </div>
      )}
    </div>
  );
}

function ResourceCard({
  title,
  description,
  badge,
  tags,
}: {
  title: string;
  description: string;
  badge: string;
  tags: string[];
}) {
  return (
    <Panel className="flex flex-col justify-between p-4 transition-all hover:border-accent/40">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
            {badge}
          </span>
        </div>
        <p className="text-xs text-ink-muted leading-relaxed">{description}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-1 border-t border-line/50 pt-3">
        {tags.map((t) => (
          <span key={t} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-subtle">
            {t}
          </span>
        ))}
      </div>
    </Panel>
  );
}
