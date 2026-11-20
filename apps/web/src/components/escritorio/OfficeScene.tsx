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
      className="overflow-hidden rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] shadow-[var(--fa-sh-1)]"
    >
      <div className="border-b border-[var(--fa-border)] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="office-scene-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">
              Visão do escritório
            </h2>
            <p className="mt-1 text-xs text-[var(--fa-muted)]">
              Simulação visual da operação. Os estados reais dependem da próxima sincronização.
            </p>
          </div>
          <StatusBadge status="active" />
        </div>
      </div>

      <div className="bg-[var(--fa-bg)] p-5">
        <div className="grid min-h-[22rem] grid-cols-1 gap-4 sm:grid-cols-2">
          {SECTORS.map((sector) => (
            <article
              key={sector.id}
              className={`flex min-h-40 flex-col justify-between rounded-[var(--fa-r-lg)] bg-gradient-to-br ${sector.tone} p-4 ring-1 ring-[color:var(--fa-navy)]/5 shadow-[var(--fa-sh-1)]`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--fa-muted-2)]">
                  Setor
                </span>
                <StatusBadge status={sector.status} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--fa-navy)]">{sector.label}</h3>
                <p className="mt-1 text-sm text-[var(--fa-muted)]">{sector.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
