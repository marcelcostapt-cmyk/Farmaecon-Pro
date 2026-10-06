import { cn } from '@/lib/utils';

export type AgentStatus = 'trabalhando' | 'ocioso' | 'offline';

const STATUS_CONFIG: Record<AgentStatus, { label: string; dot: string; text: string }> = {
  trabalhando: { label: 'Trabalhando', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  ocioso: { label: 'Ocioso', dot: 'bg-amber-500', text: 'text-amber-700' },
  offline: { label: 'Offline', dot: 'bg-gray-400', text: 'text-gray-500' },
};

interface StatusBadgeProps {
  status: AgentStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-black/5',
        config.text,
        className,
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}
