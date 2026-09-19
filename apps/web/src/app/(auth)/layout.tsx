import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Login | Farmaecon PRO',
  description: 'Acesse sua conta Farmaecon PRO',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* Left column — Branding */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-zinc-950 text-white relative overflow-hidden">
        {/* Gradient orb */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">⚡</span>
            <h1 className="text-xl font-bold">Farmaecon PRO</h1>
          </div>
          <p className="text-zinc-400 text-sm">Multi-Marketplace SaaS</p>
        </div>

        <div className="relative z-10 flex flex-col gap-8">
          {[
            { icon: '📊', title: 'Dashboard em tempo real', desc: 'KPIs, DRE e margens atualizados automaticamente' },
            { icon: '🔗', title: 'Múltiplos marketplaces', desc: 'ML, Amazon, Shopee e mais em um único painel' },
            { icon: '💰', title: 'DRE automática', desc: 'Custos, taxas e lucro calculados por pedido' },
          ].map((item) => (
            <div key={item.title} className="flex gap-4 items-start">
              <span className="text-2xl mt-0.5">{item.icon}</span>
              <div>
                <p className="font-semibold text-sm">{item.title}</p>
                <p className="text-zinc-400 text-sm">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="relative z-10 text-xs text-zinc-600">© 2025 Farmaecon PRO. Todos os direitos reservados.</p>
      </div>

      {/* Right column — Form */}
      <div className="flex items-center justify-center p-8 bg-background">
        {children}
      </div>
    </div>
  );
}
