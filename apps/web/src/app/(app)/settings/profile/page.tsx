import type { Metadata } from "next";
import { Panel, PanelHeader } from "@/components/ui/surface";
import { requirePageUser } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const user = await requirePageUser();

  const rows = [
    ["Nombre", user.name],
    ["Correo", user.email],
    ["Rol", user.role],
    ["Plan", user.plan],
  ] as const;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Perfil</h1>
        <p className="mt-1 text-sm text-ink-muted">Datos de tu cuenta.</p>
      </div>

      <Panel>
        <PanelHeader title="Cuenta" />
        <dl className="divide-y divide-line">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between px-4 py-3">
              <dt className="text-xs text-ink-subtle">{label}</dt>
              <dd className="text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <p className="text-[11px] text-ink-subtle">
        La edición de perfil, el cambio de contraseña y la verificación de
        correo se habilitan junto con el módulo de cuentas ampliado.
      </p>
    </div>
  );
}
