import type { ToolApproval } from '../hooks/useGateway';

type Props = {
  approval: ToolApproval;
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string, reason?: string) => void;
};

export function ApprovalCard({ approval, onApprove, onDeny }: Props) {
  const { requestId, toolName, input, timestamp } = approval;

  const renderDetail = () => {
    if (toolName === 'Bash' || toolName === 'bash') {
      return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '6px 0', color: 'var(--accent-amber)' }}>{(input.command as string) || ''}</pre>;
    }
    return <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto', margin: '6px 0', color: 'var(--text-secondary)' }}>{JSON.stringify(input, null, 2)}</pre>;
  };

  return (
    <div style={{
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--accent-amber)',
      borderRadius: 'var(--radius)',
      padding: '10px 12px',
      marginBottom: 8,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-amber)', marginBottom: 4 }}>
        approval required
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 4 }}>
        tool: <span style={{ color: 'var(--accent-blue)' }}>{toolName}</span>
      </div>
      {renderDetail()}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          onClick={() => onApprove(requestId)}
          style={{
            background: 'var(--accent-green)',
            color: '#000',
            border: 'none',
            borderRadius: 4,
            padding: '4px 12px',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >allow</button>
        <button
          onClick={() => onDeny(requestId, 'user denied')}
          style={{
            background: 'var(--accent-red)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '4px 12px',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >deny</button>
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
        {new Date(timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}
