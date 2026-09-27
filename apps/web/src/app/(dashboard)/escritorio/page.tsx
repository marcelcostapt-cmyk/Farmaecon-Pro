import { AgentStatusList } from '@/components/escritorio/AgentStatusList';
import { OfficeScene } from '@/components/escritorio/OfficeScene';

export default function EscritorioPage() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Escritório Virtual</h1>
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700">
            Modo Observação
          </span>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Acompanhe os setores e agentes do Farmaecon. Nesta fase, os agentes
          analisam e recomendam, mas não executam alterações comerciais.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <OfficeScene />
        <AgentStatusList />
      </div>
    </div>
  );
}
