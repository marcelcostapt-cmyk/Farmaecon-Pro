import { StatusBadge, type AgentStatus } from './StatusBadge';

const SECTORS: Array<{
  id: string;
  label: string;
  detail: string;
  status: AgentStatus;
  tone: string;
}> = [
  {
    id: 'gestao',
    label: 'Gestão',
    detail: 'Pauta e decisões',
    status: 'active',
    tone: 'from-orange-100 to-amber-50',
  },
  {
    id: 'analise',
    label: 'Análise',
    detail: 'Dados e margem',
    status: 'active',
    tone: 'from-sky-100 to-cyan-50',
  },
  {
    id: 'catalogo',
    label: 'Catálogo',
    detail: 'Anúncios e criativos',
    status: 'attention',
    tone: 'from-violet-100 to-fuchsia-50',
  },
  {
    id: 'relacionamento',
    label: 'Relacionamento',
    detail: 'SAC e oportunidades',
    status: 'blocked',
    tone: 'from-rose-100 to-pink-50',
  },
];

export function OfficeScene() {
  return (
    <section
      aria-labelledby="office-scene-title"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="office-scene-title" className="text-sm font-semibold">
              Visão do escritório
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Simulação visual da operação. Os estados reais dependem da próxima sincronização.
            </p>
          </div>
          <StatusBadge status="active" />
        </div>
      </div>

      <div className="bg-gradient-to-br from-slate-50 via-white to-orange-50 p-5">
        <div className="grid min-h-[22rem] grid-cols-1 gap-4 sm:grid-cols-2">
          {SECTORS.map((sector) => (
            <article
              key={sector.id}
              className={`flex min-h-40 flex-col justify-between rounded-2xl bg-gradient-to-br ${sector.tone} p-4 ring-1 ring-black/5`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                  Setor
                </span>
                <StatusBadge status={sector.status} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{sector.label}</h3>
                <p className="mt-1 text-sm text-slate-600">{sector.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
