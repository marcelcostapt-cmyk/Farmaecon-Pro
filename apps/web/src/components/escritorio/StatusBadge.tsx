export type AgentStatus =
  | 'active' | 'attention' | 'idle' | 'blocked' | 'trabalhando' | 'ocioso' | 'offline'
  | 'nunca-executado' | 'em-execucao' | 'concluido' | 'bloqueado-dependencia' | 'falhou' | 'nao-implementado' | 'indisponivel';

// Pares de estado do sistema C2 (docs/design/tokens.css): fundo + texto + ponto, SEMPRE com rótulo.
const STATUS_CONFIG: Record<AgentStatus, { label: string; fg: string; bg: string }> = {
  active: { label: 'Ativo', fg: 'var(--fa-pos)', bg: 'var(--fa-ok-bg)' },
  trabalhando: { label: 'Trabalhando', fg: 'var(--fa-pos)', bg: 'var(--fa-ok-bg)' },
  attention: { label: 'Atenção', fg: 'var(--fa-warn)', bg: 'var(--fa-warn-bg)' },
  idle: { label: 'Ocioso', fg: 'var(--fa-info)', bg: 'var(--fa-info-bg)' },
  ocioso: { label: 'Ocioso', fg: 'var(--fa-info)', bg: 'var(--fa-info-bg)' },
  blocked: { label: 'Bloqueado', fg: 'var(--fa-neg)', bg: 'var(--fa-neg-bg)' },
  offline: { label: 'Offline', fg: 'var(--fa-st-off-fg)', bg: 'var(--fa-st-off-bg)' },
  'nunca-executado': { label: 'Nunca executado', fg: 'var(--fa-st-off-fg)', bg: 'var(--fa-st-off-bg)' },
  'em-execucao': { label: 'Em execução', fg: 'var(--fa-info)', bg: 'var(--fa-info-bg)' },
  concluido: { label: 'Concluído', fg: 'var(--fa-pos)', bg: 'var(--fa-ok-bg)' },
  'bloqueado-dependencia': { label: 'Bloqueado por dependência', fg: 'var(--fa-warn)', bg: 'var(--fa-warn-bg)' },
  falhou: { label: 'Falhou', fg: 'var(--fa-neg)', bg: 'var(--fa-neg-bg)' },
  'nao-implementado': { label: 'Ainda não implementado', fg: 'var(--fa-st-off-fg)', bg: 'var(--fa-st-off-bg)' },
  indisponivel: { label: 'Estado indisponível', fg: 'var(--fa-st-off-fg)', bg: 'var(--fa-st-off-bg)' },
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
