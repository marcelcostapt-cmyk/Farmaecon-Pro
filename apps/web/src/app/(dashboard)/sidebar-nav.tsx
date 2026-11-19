'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Navegação da sidebar com realce do item ativo por rota (sistema C2: ativo = laranja + texto branco).
const ITEMS: Array<{ label: string; href: string }> = [
  { label: '🏢 Escritório', href: '/escritorio' },
  { label: '📊 Dashboard', href: '/dashboard' },
  { label: '🛒 Pedidos', href: '/orders' },
  { label: 'Relatório de observação', href: '/observation' },
  { label: '📈 Margem por SKU', href: '/margin/preview' },
  { label: '💰 Financeiro', href: '/finance' },
  { label: '🔗 Integrações', href: '/integrations' },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav() {
  const pathname = usePathname() ?? '';

  return (
    <nav className="flex flex-col gap-1 flex-1">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex items-center gap-2 px-3 py-2 rounded-[var(--fa-r-sm)] text-sm font-semibold transition-colors',
              active
                ? 'bg-[var(--fa-orange)] text-white'
                : 'text-[var(--fa-side-text)] hover:bg-[var(--fa-navy-hover)] hover:text-white',
            ].join(' ')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
