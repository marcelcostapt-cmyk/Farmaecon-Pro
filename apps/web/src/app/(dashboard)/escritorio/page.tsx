import { AgentStatusList } from '@/components/escritorio/AgentStatusList';
import { OfficeScene } from '@/components/escritorio/OfficeScene';

export default function EscritorioPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Escritório Virtual</h1>
        <p className="text-sm text-gray-500">
          Acompanhe em tempo real o status dos setores e agentes do Farmaecon.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <OfficeScene />
        </div>

        <div className="lg:col-span-1">
          <AgentStatusList />
        </div>
      </div>
    </div>
  );
}
