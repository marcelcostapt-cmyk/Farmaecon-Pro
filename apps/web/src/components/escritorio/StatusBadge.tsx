export type AgentStatus = 'active' | 'attention' | 'idle' | 'blocked' | 'trabalhando' | 'ocioso' | 'offline';

// Pares de estado do sistema C2 (docs/design/tokens.css): fundo + texto + ponto, SEMPRE com rótulo.
const STATUS_CONFIG: Record<AgentStatus, { label: string; fg: string; bg: string }> = {
  active: { label: 'Ativo', fg: 'var(--fa-pos)', bg: 'var(--fa-ok-bg)' },
  trabalhando: { label: 'Trabalhando', fg: 'var(--fa-pos)', bg: 'var(--fa-ok-bg)' },
  attention: { label: 'Atenção', fg: 'var(--fa-warn)', bg: 'var(--fa-warn-bg)' },
  idle: { label: 'Ocioso', fg: 'var(--fa-info)', bg: 'var(--fa-info-bg)' },
  ocioso: { label: 'Ocioso', fg: 'var(--fa-info)', bg: 'var(--fa-info-bg)' },
  blocked: { label: 'Bloqueado', fg: 'var(--fa-neg)', bg: 'var(--fa-neg-bg)' },
  offline: { label: 'Offline', fg: 'var(--fa-st-off-fg)', bg: 'var(--fa-st-off-bg)' },
};

export function StatusBadge({ status, className = '' }: { status: AgentStatus; className?: string }) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={['inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', className].join(' ')}
      style={{ color: config.fg, backgroundColor: config.bg }}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: config.fg }} />
      {config.label}
    </span>
  );
}
