import { redirect } from 'next/navigation';
import { logoutAction, getCurrentUser } from '@/lib/auth';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard | Farmaecon PRO',
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="flex flex-col w-48 lg:w-64 border-r bg-card px-4 py-6 gap-2">
        <div className="px-2 mb-6">
          <h1 className="text-xl font-bold text-primary">Farmaecon PRO</h1>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {[
            { label: '📊 Dashboard',     href: '/dashboard' },
            { label: '🛒 Pedidos',       href: '/orders' },
            { label: 'Relatório de observação', href: '/observation' },
            { label: '💰 Financeiro',    href: '/finance' },
            { label: '🔗 Integrações',   href: '/integrations' },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Logout */}
        <div className="border-t pt-4">
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full text-left px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              🚪 Sair
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <header className="border-b px-6 py-4 flex items-center justify-between bg-card">
          <h2 className="text-sm font-medium text-muted-foreground">Farmaecon PRO</h2>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-xs bg-green-500/10 text-green-600 px-2 py-1 rounded-full font-medium">
              <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
              Modo Observação
            </span>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
