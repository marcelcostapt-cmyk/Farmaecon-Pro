import { redirect } from 'next/navigation';
import { logoutAction, getCurrentUser } from '@/lib/auth';
import type { Metadata } from 'next';
import { SidebarNav } from './sidebar-nav';

export const metadata: Metadata = {
  title: 'Dashboard | Farmaecon PRO',
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex flex-col w-48 lg:w-64 px-4 py-6 gap-2 bg-[var(--fa-navy)] text-[var(--fa-side-text)]">
        <div className="px-2 mb-6">
          <h1 className="text-xl font-extrabold tracking-tight text-white">
            Farmaecon <span className="text-[var(--fa-orange)]">PRO</span>
          </h1>
          <p className="text-xs text-[var(--fa-side-text-2)]">{user.email}</p>
        </div>
        <SidebarNav />

        <div className="border-t border-[var(--fa-navy-700)] pt-4">
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full text-left px-3 py-2 rounded-[var(--fa-r-sm)] text-sm text-[var(--fa-side-text)] hover:bg-[var(--fa-navy-hover)] hover:text-white transition-colors"
            >
              🚪 Sair
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-[var(--fa-bg)]">
        <header className="border-b border-[var(--fa-border)] px-6 py-4 flex items-center justify-between bg-[var(--fa-surface)]">
          <h2 className="text-sm font-semibold text-[var(--fa-navy)]">Farmaecon PRO</h2>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs bg-[var(--fa-orange-bg)] text-[var(--fa-orange-700)] px-2.5 py-1 rounded-full font-semibold ring-1 ring-[color:var(--fa-orange)]/30">
              <span className="size-1.5 rounded-full bg-[var(--fa-orange)]" />
              Modo Observação
            </span>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
