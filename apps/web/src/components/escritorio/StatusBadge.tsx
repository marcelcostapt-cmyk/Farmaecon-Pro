export type AgentStatus = 'active' | 'attention' | 'idle' | 'blocked';

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; dot: string; text: string }
> = {
  active: {
    label: 'Ativo',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
  },
  attention: {
    label: 'Atenção',
    dot: 'bg-amber-500',
    text: 'text-amber-700',
  },
  idle: {
    label: 'Ocioso',
    dot: 'bg-slate-400',
    text: 'text-slate-600',
  },
  blocked: {
    label: 'Bloqueado',
    dot: 'bg-rose-500',
    text: 'text-rose-700',
  },
};

export function StatusBadge({
  status,
  className = '',
}: {
  status: AgentStatus;
  className?: string;
}) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-black/5',
        config.text,
        className,
      ].join(' ')}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
