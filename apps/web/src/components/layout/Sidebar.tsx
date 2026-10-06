'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  LayoutDashboard,
  Megaphone,
  MessageCircleQuestion,
  CalendarClock,
  BarChart3,
  Rocket,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/escritorio', label: 'Escritório', icon: Building2 },
  { href: '/painel', label: 'Painel', icon: LayoutDashboard },
  { href: '/anuncios', label: 'Anúncios', icon: Rocket },
  { href: '/campanhas', label: 'Campanhas', icon: Megaphone },
  { href: '/perguntas', label: 'Perguntas', icon: MessageCircleQuestion },
  { href: '/reunioes', label: 'Reuniões', icon: CalendarClock },
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 flex-col border-r border-gray-200 bg-white px-3 py-4">
      <div className="mb-6 px-2 text-lg font-bold text-orange-600">Farmaecon</div>

      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-orange-50 text-orange-600'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
