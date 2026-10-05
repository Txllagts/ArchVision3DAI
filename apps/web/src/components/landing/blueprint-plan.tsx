"use client";

import { cn } from "@/lib/utils";

/**
 * Esquema vectorial de un plano arquitectónico técnico (blueprint).
 * Muros, vanos con arco de apertura, cotas con cotación numérica,
 * burbujas de ejes estructurales y cuadrícula de precisión CAD.
 */
export function BlueprintFloorPlan({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none select-none overflow-hidden",
        className,
      )}
    >
      <svg
        viewBox="0 0 900 650"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="size-full opacity-60 transition-opacity duration-700 hover:opacity-80"
      >
        <defs>
          {/* Trama de cuadrícula milimétrica CAD */}
          <pattern
            id="cad-grid-sm"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-line/40"
            />
          </pattern>
          <pattern
            id="cad-grid-lg"
            width="100"
            height="100"
            patternUnits="userSpaceOnUse"
          >
            <rect width="100" height="100" fill="url(#cad-grid-sm)" />
            <path
              d="M 100 0 L 0 0 0 100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              className="text-line-strong/30"
            />
          </pattern>

          {/* Símbolo de cota (flecha/tick) */}
          <marker
            id="cota-tick"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 2 8 L 8 2" stroke="currentColor" strokeWidth="1.5" className="text-accent" />
          </marker>
        </defs>

        {/* Fondo de rejilla técnica interna */}
        <rect x="50" y="50" width="800" height="550" fill="url(#cad-grid-lg)" opacity="0.7" />

        {/* ------------------------------------------------------------- */}
        {/* EJES ESTRUCTURALES Y BURBUJAS (A, B, C / 1, 2, 3)             */}
        {/* ------------------------------------------------------------- */}
        <g className="text-ink-subtle/50 text-[11px] font-mono">
          {/* Eje A */}
          <line x1="120" y1="25" x2="120" y2="615" stroke="currentColor" strokeDasharray="6 4" strokeWidth="0.75" />
          <circle cx="120" cy="25" r="14" className="fill-surface stroke-line-strong" strokeWidth="1" />
          <text x="120" y="29" textAnchor="middle" className="fill-ink font-semibold">A</text>

          {/* Eje B */}
          <line x1="420" y1="25" x2="420" y2="615" stroke="currentColor" strokeDasharray="6 4" strokeWidth="0.75" />
          <circle cx="420" cy="25" r="14" className="fill-surface stroke-line-strong" strokeWidth="1" />
          <text x="420" y="29" textAnchor="middle" className="fill-ink font-semibold">B</text>

          {/* Eje C */}
          <line x1="720" y1="25" x2="720" y2="615" stroke="currentColor" strokeDasharray="6 4" strokeWidth="0.75" />
          <circle cx="720" cy="25" r="14" className="fill-surface stroke-line-strong" strokeWidth="1" />
          <text x="720" y="29" textAnchor="middle" className="fill-ink font-semibold">C</text>

          {/* Eje 1 */}
          <line x1="25" y1="120" x2="815" y2="120" stroke="currentColor" strokeDasharray="6 4" strokeWidth="0.75" />
          <circle cx="25" cy="120" r="14" className="fill-surface stroke-line-strong" strokeWidth="1" />
          <text x="25" y="124" textAnchor="middle" className="fill-ink font-semibold">1</text>

          {/* Eje 2 */}
          <line x1="25" y1="360" x2="815" y2="360" stroke="currentColor" strokeDasharray="6 4" strokeWidth="0.75" />
          <circle cx="25" cy="120" r="14" className="fill-surface stroke-line-strong" strokeWidth="1" />
          <circle cx="25" cy="360" r="14" className="fill-surface stroke-line-strong" strokeWidth="1" />
          <text x="25" y="364" textAnchor="middle" className="fill-ink font-semibold">2</text>

          {/* Eje 3 */}
          <line x1="25" y1="560" x2="815" y2="560" stroke="currentColor" strokeDasharray="6 4" strokeWidth="0.75" />
          <circle cx="25" cy="560" r="14" className="fill-surface stroke-line-strong" strokeWidth="1" />
          <text x="25" y="564" textAnchor="middle" className="fill-ink font-semibold">3</text>
        </g>

        {/* ------------------------------------------------------------- */}
        {/* MUROS EXTERIORES E INTERIORES (Líneas dobles y relleno)      */}
        {/* ------------------------------------------------------------- */}
        <g className="text-accent">
          {/* Muros perimetrales - Línea principal sólida */}
          <path
            d="
              M 120 120
              L 720 120
              L 720 560
              L 380 560
              L 380 480
              L 120 480
              Z
            "
            fill="currentColor"
            fillOpacity="0.06"
            stroke="currentColor"
            strokeWidth="3.5"
            className="text-accent"
          />

          {/* Muro perimetral interior (doble línea técnica de muro) */}
          <path
            d="
              M 132 132
              L 708 132
              L 708 548
              L 392 548
              L 392 468
              L 132 468
              Z
            "
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            className="text-accent/70"
          />

          {/* Muros divisores internos */}
          {/* Muro vertical central (Eje B) */}
          <line x1="420" y1="132" x2="420" y2="300" stroke="currentColor" strokeWidth="3" className="text-accent" />
          <line x1="420" y1="380" x2="420" y2="548" stroke="currentColor" strokeWidth="3" className="text-accent" />

          {/* Muro horizontal (Eje 2) */}
          <line x1="132" y1="360" x2="330" y2="360" stroke="currentColor" strokeWidth="3" className="text-accent" />
          <line x1="420" y1="360" x2="620" y2="360" stroke="currentColor" strokeWidth="3" className="text-accent" />

          {/* Muro baño / servicio */}
          <line x1="280" y1="360" x2="280" y2="468" stroke="currentColor" strokeWidth="2.5" className="text-accent/80" />
        </g>

        {/* ------------------------------------------------------------- */}
        {/* PUERTAS CON ARCO DE BATIENTE (Door swings)                   */}
        {/* ------------------------------------------------------------- */}
        <g className="text-accent-hover">
          {/* Puerta 1: Entrada Principal (Abajo izquierda) */}
          <line x1="180" y1="480" x2="180" y2="435" stroke="currentColor" strokeWidth="1.5" />
          <path d="M 180 435 A 45 45 0 0 1 225 480" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />

          {/* Puerta 2: Habitación 1 (Interior) */}
          <line x1="330" y1="360" x2="365" y2="360" stroke="currentColor" strokeWidth="1.5" />
          <path d="M 365 360 A 35 35 0 0 1 330 395" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />

          {/* Puerta 3: Baño */}
          <line x1="280" y1="400" x2="280" y2="430" stroke="currentColor" strokeWidth="1.5" />
          <path d="M 280 430 A 30 30 0 0 0 250 400" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />

          {/* Puerta 4: Dormitorio Principal */}
          <line x1="420" y1="300" x2="420" y2="340" stroke="currentColor" strokeWidth="1.5" />
          <path d="M 420 340 A 40 40 0 0 1 460 300" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
        </g>

        {/* ------------------------------------------------------------- */}
        {/* VENTANAS (Líneas de vanos arquitectónicos)                    */}
        {/* ------------------------------------------------------------- */}
        <g className="text-glacier-cyan">
          {/* Ventana Sala (Arriba centro) */}
          <rect x="220" y="117" width="100" height="6" className="fill-canvas stroke-accent" strokeWidth="1" />
          <line x1="220" y1="120" x2="320" y2="120" stroke="currentColor" strokeWidth="1" />

          {/* Ventana Comedor (Arriba derecha) */}
          <rect x="520" y="117" width="120" height="6" className="fill-canvas stroke-accent" strokeWidth="1" />
          <line x1="520" y1="120" x2="640" y2="120" stroke="currentColor" strokeWidth="1" />

          {/* Ventana Dormitorio (Lateral derecho) */}
          <rect x="717" y="220" width="6" height="80" className="fill-canvas stroke-accent" strokeWidth="1" />
          <line x1="720" y1="220" x2="720" y2="300" stroke="currentColor" strokeWidth="1" />

          {/* Ventana Suite (Lateral derecho inferior) */}
          <rect x="717" y="420" width="6" height="90" className="fill-canvas stroke-accent" strokeWidth="1" />
          <line x1="720" y1="420" x2="720" y2="510" stroke="currentColor" strokeWidth="1" />
        </g>

        {/* ------------------------------------------------------------- */}
        {/* ESCALERA PARAMÉTRICA CON FLECHA DE SUBIDA                     */}
        {/* ------------------------------------------------------------- */}
        <g className="text-line-strong">
          <rect x="435" y="440" width="90" height="108" fill="none" stroke="currentColor" strokeWidth="1" />
          <line x1="435" y1="455" x2="525" y2="455" stroke="currentColor" strokeWidth="0.8" />
          <line x1="435" y1="470" x2="525" y2="470" stroke="currentColor" strokeWidth="0.8" />
          <line x1="435" y1="485" x2="525" y2="485" stroke="currentColor" strokeWidth="0.8" />
          <line x1="435" y1="500" x2="525" y2="500" stroke="currentColor" strokeWidth="0.8" />
          <line x1="435" y1="515" x2="525" y2="515" stroke="currentColor" strokeWidth="0.8" />
          <line x1="435" y1="530" x2="525" y2="530" stroke="currentColor" strokeWidth="0.8" />
          {/* Flecha de subida */}
          <line x1="480" y1="540" x2="480" y2="450" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" className="text-accent" />
          <path d="M 476 455 L 480 445 L 484 455" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-accent" />
          <text x="480" y="555" textAnchor="middle" className="fill-ink-muted text-[8px] font-mono">SUBE (N+0.15)</text>
        </g>

        {/* ------------------------------------------------------------- */}
        {/* ETIQUETAS DE AMBIENTES CON ÁREA TÉCNICA (m²)                 */}
        {/* ------------------------------------------------------------- */}
        <g className="text-center font-mono select-none">
          {/* Estancia / Sala */}
          <g transform="translate(260, 230)">
            <text x="0" y="0" textAnchor="middle" className="fill-ink font-semibold text-[13px] tracking-wider">
              SALA / ESTANCIA
            </text>
            <text x="0" y="16" textAnchor="middle" className="fill-accent font-medium text-[11px]">
              28.40 m² · N+0.00
            </text>
          </g>

          {/* Cocina / Comedor */}
          <g transform="translate(560, 230)">
            <text x="0" y="0" textAnchor="middle" className="fill-ink font-semibold text-[13px] tracking-wider">
              COCINA / COMEDOR
            </text>
            <text x="0" y="16" textAnchor="middle" className="fill-accent font-medium text-[11px]">
              21.60 m² · N+0.00
            </text>
          </g>

          {/* Dormitorio Principal */}
          <g transform="translate(600, 460)">
            <text x="0" y="0" textAnchor="middle" className="fill-ink font-semibold text-[13px] tracking-wider">
              DORMITORIO MASTER
            </text>
            <text x="0" y="16" textAnchor="middle" className="fill-accent font-medium text-[11px]">
              19.80 m² · N+0.00
            </text>
          </g>

          {/* Estudio / Habitación 2 */}
          <g transform="translate(200, 410)">
            <text x="0" y="0" textAnchor="middle" className="fill-ink font-semibold text-[11px] tracking-wider">
              ESTUDIO
            </text>
            <text x="0" y="14" textAnchor="middle" className="fill-accent font-medium text-[10px]">
              12.50 m²
            </text>
          </g>

          {/* Baño */}
          <g transform="translate(330, 420)">
            <text x="0" y="0" textAnchor="middle" className="fill-ink font-semibold text-[10px] tracking-wider">
              BAÑO
            </text>
            <text x="0" y="13" textAnchor="middle" className="fill-accent font-medium text-[9px]">
              4.60 m²
            </text>
          </g>
        </g>

        {/* ------------------------------------------------------------- */}
        {/* LÍNEAS DE COTA DIMENSIONAL EXTERIORES (Medidas exactas)      */}
        {/* ------------------------------------------------------------- */}
        <g className="text-accent/90 font-mono text-[10px]">
          {/* Cota superior total (120 a 720 = 12.00m) */}
          <line x1="120" y1="75" x2="720" y2="75" stroke="currentColor" strokeWidth="1" markerStart="url(#cota-tick)" markerEnd="url(#cota-tick)" />
          <line x1="120" y1="65" x2="120" y2="85" stroke="currentColor" strokeWidth="0.8" />
          <line x1="720" y1="65" x2="720" y2="85" stroke="currentColor" strokeWidth="0.8" />
          <rect x="390" y="66" width="60" height="18" className="fill-canvas" />
          <text x="420" y="79" textAnchor="middle" className="fill-accent font-semibold">12.00 m</text>

          {/* Cota superior parcial 1 */}
          <line x1="120" y1="95" x2="420" y2="95" stroke="currentColor" strokeWidth="0.8" />
          <rect x="245" y="87" width="50" height="16" className="fill-canvas" />
          <text x="270" y="99" textAnchor="middle" className="fill-ink-muted">6.00 m</text>

          {/* Cota superior parcial 2 */}
          <line x1="420" y1="95" x2="720" y2="95" stroke="currentColor" strokeWidth="0.8" />
          <rect x="545" y="87" width="50" height="16" className="fill-canvas" />
          <text x="570" y="99" textAnchor="middle" className="fill-ink-muted">6.00 m</text>

          {/* Cota lateral derecha total (120 a 560 = 8.80m) */}
          <line x1="765" y1="120" x2="765" y2="560" stroke="currentColor" strokeWidth="1" markerStart="url(#cota-tick)" markerEnd="url(#cota-tick)" />
          <line x1="755" y1="120" x2="775" y2="120" stroke="currentColor" strokeWidth="0.8" />
          <line x1="755" y1="560" x2="775" y2="560" stroke="currentColor" strokeWidth="0.8" />
          <rect x="740" y="330" width="50" height="18" className="fill-canvas" />
          <text x="765" y="343" textAnchor="middle" className="fill-accent font-semibold">8.80 m</text>
        </g>

        {/* ------------------------------------------------------------- */}
        {/* ROSA DE LOS VIENTOS / NORTE Y CUADRO DE ESCALA               */}
        {/* ------------------------------------------------------------- */}
        <g transform="translate(760, 80)" className="text-accent">
          <circle cx="0" cy="0" r="18" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
          <path d="M 0 -15 L 4 0 L 0 -3 L -4 0 Z" fill="currentColor" />
          <path d="M 0 15 L 4 0 L 0 3 L -4 0 Z" fill="currentColor" opacity="0.4" />
          <text x="0" y="-21" textAnchor="middle" className="fill-accent font-mono font-bold text-[10px]">N</text>
        </g>

        {/* Cartela técnica de proyecto en esquina inferior */}
        <g transform="translate(120, 515)" className="font-mono text-[9px] text-ink-subtle">
          <rect x="0" y="0" width="220" height="40" className="fill-surface/80 stroke-line-strong" strokeWidth="0.8" />
          <text x="10" y="14" className="fill-ink font-semibold">PROYECTO: RESIDENCIA TIPO A-1</text>
          <text x="10" y="26" className="fill-accent">ESCALA 1:50 · DETECCIÓN IA v2.4</text>
          <text x="10" y="36" className="fill-ink-subtle">SISTEMA: ARCHVISION 3D MOTOR</text>
        </g>
      </svg>
    </div>
  );
}
