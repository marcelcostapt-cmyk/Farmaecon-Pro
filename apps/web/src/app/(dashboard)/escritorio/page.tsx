import { AgentStatusList } from '@/components/escritorio/AgentStatusList';
import { OfficeScene } from '@/components/escritorio/OfficeScene';
import { MargemResumoCard } from '@/components/escritorio/MargemResumoCard';
import { LotesResumoCard } from '@/components/escritorio/LotesResumoCard';

export default function EscritorioPage() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--fa-navy)]">Escritório Virtual</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--fa-orange-bg)] px-3 py-1 text-xs font-semibold text-[var(--fa-orange-700)] ring-1 ring-[color:var(--fa-orange)]/30">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--fa-orange)]" />
            Modo Observação
          </span>
        </div>
        <p className="max-w-2xl text-sm text-[var(--fa-muted)]">
          Acompanhe os setores e agentes do Farmaecon. Nesta fase, os agentes
          analisam e recomendam, mas não executam alterações comerciais.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <OfficeScene />
        <AgentStatusList />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MargemResumoCard />
        <LotesResumoCard />
      </div>
    </div>
  );
}
