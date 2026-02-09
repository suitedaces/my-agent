import type { ProgressItem } from '../hooks/useGateway';
import { Check, Circle, Loader2 } from 'lucide-react';

export function Progress({ items }: { items: ProgressItem[] }) {
  if (items.length === 0) return null;

  const done = items.filter(i => i.status === 'completed').length;
  const total = items.length;

  return (
    <div className="border-b border-border bg-card px-3 py-2 shrink-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">progress</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{done}/{total}</span>
      </div>
      <div className="w-full h-1 bg-secondary rounded-full mb-2 overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
      <div className="space-y-0.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            {item.status === 'completed' ? (
              <Check className="w-3 h-3 text-success shrink-0" />
            ) : item.status === 'in_progress' ? (
              <Loader2 className="w-3 h-3 text-primary shrink-0 animate-spin" />
            ) : (
              <Circle className="w-3 h-3 text-muted-foreground shrink-0" />
            )}
            <span className={item.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}>
              {item.status === 'in_progress' ? item.activeForm : item.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
