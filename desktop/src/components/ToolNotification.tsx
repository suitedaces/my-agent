import type { ToolNotification as ToolNotifType } from '../hooks/useGateway';

type Props = {
  notifications: ToolNotifType[];
};

export function ToolNotifications({ notifications }: Props) {
  if (notifications.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 46,
      right: 12,
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      maxWidth: 300,
    }}>
      {notifications.map((n, i) => (
        <div key={i} style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '6px 10px',
          fontSize: 10,
          color: 'var(--text-secondary)',
          animation: 'fadeIn 0.2s ease',
        }}>
          <span style={{ color: 'var(--accent-blue)' }}>{n.toolName}</span>
          {' — '}
          {n.toolName === 'mcp__my-agent__message' ? 'sending message' :
           n.toolName === 'mcp__my-agent__schedule_recurring' ? 'scheduling task' :
           n.toolName === 'mcp__my-agent__schedule_cron' ? 'scheduling cron' :
           'executing'}
        </div>
      ))}
    </div>
  );
}
