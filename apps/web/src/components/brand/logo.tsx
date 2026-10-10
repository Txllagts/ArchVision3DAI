import { brand } from "@archvision/config";
import { cn } from "@/lib/utils";

/**
 * Icono de edificio isométrico 3D oficial de ArchVision.
 */
export function ArchVisionBuildingIcon({
  className = "size-8",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 140 130"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {/* Cornisa Superior - Techo Isométrico */}
      <polygon
        points="32,18 78,6 122,18 78,32"
        fill="#38bdf8"
        stroke="#0284c7"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Saliente de cornisa izquierda */}
      <polygon
        points="30,20 78,33 78,38 30,24"
        fill="#38bdf8"
      />
      {/* Saliente de cornisa derecha */}
      <polygon
        points="78,33 124,20 124,24 78,38"
        fill="#0284c7"
      />

      {/* Fachada Principal Izquierda (Luz) */}
      <polygon
        points="33,26 78,39 78,118 33,103"
        fill="#38bdf8"
      />

      {/* Fachada Lateral Derecha (Sombra) */}
      <polygon
        points="78,39 122,26 122,105 78,118"
        fill="#0284c7"
      />

      {/* --- VENTANAS FACHADA IZQUIERDA --- */}
      {/* Piso 3: Ventanas Arqueadas */}
      {/* Ventana Izq */}
      <path
        d="M 40,43 Q 44,38 48,42 L 48,58 L 40,55 Z"
        fill="#ffffff"
      />
      {/* Ventana Centro */}
      <path
        d="M 53,47 Q 57,42 61,46 L 61,62 L 53,59 Z"
        fill="#ffffff"
      />
      {/* Ventana Der */}
      <path
        d="M 66,51 Q 70,46 74,50 L 74,66 L 66,63 Z"
        fill="#ffffff"
      />

      {/* Piso 2: Ventanas Rectangulares */}
      {/* Ventana Izq */}
      <polygon points="40,65 48,68 48,80 40,77" fill="#ffffff" />
      {/* Ventana Centro */}
      <polygon points="53,69 61,72 61,84 53,81" fill="#ffffff" />
      {/* Ventana Der */}
      <polygon points="66,73 74,76 74,88 66,85" fill="#ffffff" />

      {/* Moldura / Friso Planta Baja */}
      <polygon points="33,84 78,97 78,99 33,86" fill="#0284c7" opacity="0.6" />
      {/* Puntos decorativos en el friso */}
      <circle cx="41" cy="87" r="1.2" fill="#ffffff" />
      <circle cx="50" cy="90" r="1.2" fill="#ffffff" />
      <circle cx="59" cy="93" r="1.2" fill="#ffffff" />
      <circle cx="68" cy="96" r="1.2" fill="#ffffff" />

      {/* Piso 1: Planta Baja y Entrada */}
      {/* Escaparate Izquierdo */}
      <polygon points="39,94 49,97 49,111 39,107" fill="#ffffff" />
      {/* Puerta Central */}
      <polygon points="53,99 63,102 63,117 53,113" fill="#ffffff" />
      {/* Detalle puerta interior */}
      <line x1="58" y1="100.5" x2="58" y2="115" stroke="#38bdf8" strokeWidth="1.2" />
      {/* Escaparate Derecho */}
      <polygon points="67,103 74,105 74,117 67,115" fill="#ffffff" />

      {/* --- VENTANAS FACHADA DERECHA (Perspectiva fugada) --- */}
      {/* Piso 3 */}
      <polygon points="84,49 94,45 94,60 84,63" fill="#ffffff" />
      <polygon points="101,43 111,39 111,53 101,57" fill="#ffffff" />

      {/* Piso 2 */}
      <polygon points="84,70 94,66 94,80 84,84" fill="#ffffff" />
      <polygon points="101,63 111,59 111,73 101,77" fill="#ffffff" />

      {/* Moldura friso derecha */}
      <polygon points="78,97 122,84 122,86 78,99" fill="#0369a1" opacity="0.7" />

      {/* Piso 1 */}
      <polygon points="84,91 94,87 94,107 84,111" fill="#ffffff" />
      <polygon points="101,84 111,80 111,100 101,104" fill="#ffffff" />
    </svg>
  );
}

/**
 * Componente principal del Logo de ArchVision 3D AI.
 */
export function Logo({
  collapsed = false,
  className,
  size = "md",
}: {
  collapsed?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const iconSizeClass =
    size === "sm" ? "size-7" : size === "lg" ? "size-11" : "size-8";

  return (
    <span className={cn("inline-flex items-center gap-2.5 group select-none", className)}>
      <ArchVisionBuildingIcon className={iconSizeClass} />
      {!collapsed ? (
        <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="font-display text-[17px] font-bold tracking-tight text-white transition-colors group-hover:text-accent">
            ArchVision
          </span>
          <span className="font-display text-[15px] font-extrabold tracking-wide text-accent">
            3D AI
          </span>
        </span>
      ) : null}
    </span>
  );
}
