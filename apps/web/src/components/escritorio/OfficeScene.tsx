import { StatusBadge, type AgentStatus } from './StatusBadge';

interface SectorMarker {
  id: string;
  label: string;
  status: AgentStatus;
  top: string;
  left: string;
}

const SECTOR_MARKERS: SectorMarker[] = [
  { id: 'vendas', label: 'Vendas', status: 'trabalhando', top: '20%', left: '18%' },
  { id: 'estoque', label: 'Estoque', status: 'ocioso', top: '55%', left: '12%' },
  { id: 'ads', label: 'Marketing', status: 'trabalhando', top: '15%', left: '65%' },
  { id: 'financeiro', label: 'Financeiro', status: 'ocioso', top: '60%', left: '70%' },
  { id: 'sac', label: 'Suporte', status: 'offline', top: '75%', left: '45%' },
];

export function OfficeScene() {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-orange-50 to-white shadow-sm">
      <div
        className="relative aspect-[16/9] w-full bg-[linear-gradient(to_right,rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.04)_1px,transparent_1px)] bg-[size:24px_24px]"
      >
        {SECTOR_MARKERS.map((marker) => (
          <div
            key={marker.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ top: marker.top, left: marker.left }}
          >
            <StatusBadge status={marker.status} className="whitespace-nowrap" />
          </div>
        ))}
      </div>
    </div>
  );
}
