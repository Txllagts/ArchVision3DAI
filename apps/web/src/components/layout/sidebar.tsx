"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  Boxes,
  Clock,
  CreditCard,
  FileStack,
  FolderOpen,
  Home,
  Layers,
  LibraryBig,
  Plus,
  Settings,
  Share2,
  Sofa,
  Trash2,
  User,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * Navegacion lateral del dashboard.
 *
 * Los modulos que aun no existen se muestran deshabilitados con la fase en la
 * que llegan: es preferible a un enlace que lleva a una pantalla vacia.
 */

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  phase?: string;
}

const MAIN: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: Home },
  { href: "/projects", label: "Proyectos", icon: FolderOpen },
  { href: "/projects/new", label: "Nuevo proyecto", icon: Plus },
  { href: "/projects?sort=recent", label: "Modelos recientes", icon: Clock },
];

const LIBRARIES: NavItem[] = [
  { href: "/library/materials", label: "Materiales", icon: LibraryBig, phase: "Fase 4" },
  { href: "/library/furniture", label: "Muebles", icon: Sofa, phase: "Fase 4" },
  { href: "/library/models", label: "Recursos", icon: Boxes, phase: "Fase 4" },
];

const WORK: NavItem[] = [
  { href: "/files", label: "Archivos", icon: FileStack, phase: "Fase 5" },
  { href: "/exports", label: "Exportaciones", icon: Share2, phase: "Fase 8" },
  { href: "/history", label: "Historial", icon: Layers, phase: "Fase 2" },
  { href: "/trash", label: "Papelera", icon: Trash2 },
];

const ACCOUNT: NavItem[] = [
  { href: "/settings", label: "Configuracion", icon: Settings },
  { href: "/settings/billing", label: "Facturacion", icon: CreditCard },
  { href: "/settings/profile", label: "Perfil", icon: User },
];

function NavGroup({
  title,
  items,
  pathname,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div className="space-y-1">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
        {title}
      </p>
      {items.map((item) => {
        const Icon = item.icon;
        const href = item.href.split("?")[0] ?? item.href;
        const active = pathname === href;

        if (item.phase) {
          return (
            <span
              key={item.href}
              title={`Disponible en ${item.phase}`}
              aria-disabled
              className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-1.5 text-sm text-ink-subtle/60"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
              <span className="ml-auto text-[10px] text-ink-subtle/70">{item.phase}</span>
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-accent/10 text-accent"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-14 items-center border-b border-line px-4">
        <Link href="/dashboard">
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto p-3">
        <NavGroup title="Trabajo" items={MAIN} pathname={pathname} />
        <NavGroup title="Bibliotecas" items={LIBRARIES} pathname={pathname} />
        <NavGroup title="Proyecto" items={WORK} pathname={pathname} />
        <NavGroup title="Cuenta" items={ACCOUNT} pathname={pathname} />
      </nav>

      <div className="border-t border-line p-3 text-[11px] text-ink-subtle">
        <p className="flex items-center gap-1.5">
          <Archive className="size-3.5" aria-hidden />
          Fase 1: fundacion
        </p>
      </div>
    </aside>
  );
}
