import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Farmaecon PRO — Gestão Multi-Marketplace',
  description: 'Plataforma SaaS para gestão 360° de vendas, finanças e estoque em múltiplos marketplaces.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className="font-sans">
      <body className="antialiased">{children}</body>
    </html>
  );
}
