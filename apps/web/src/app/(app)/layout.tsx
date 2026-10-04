import { Sidebar } from "@/components/layout/sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { requirePageUser } from "@/lib/auth/guards";

/**
 * Shell del area autenticada.
 * La guarda vive aqui: cualquier ruta bajo (app) exige sesion valida.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePageUser();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b border-line bg-surface px-4">
          <div className="text-sm font-semibold text-white">
            Espacio de trabajo personal
          </div>
          <UserMenu name={user.name} email={user.email} plan={user.plan} />
        </header>
        <main className="flex-1 bg-canvas">{children}</main>
      </div>
    </div>
  );
}
