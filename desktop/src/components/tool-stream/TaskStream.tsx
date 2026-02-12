import { motion, AnimatePresence } from "motion/react"
import { Bot, Cpu, Zap, Terminal, FileText, Search, Globe, Brain, Wrench } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"
import { ElapsedTime } from "./ElapsedTime"

type SubItem = {
  type: string
  content?: string
  id?: string
  name?: string
  input?: string
  output?: string
  is_error?: boolean
  streaming?: boolean
}

const SUB_TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Bash: Terminal, Read: FileText, Write: FileText, Edit: FileText,
  Glob: Search, Grep: Search, WebFetch: Globe, WebSearch: Globe,
}

function BrainPulse() {
  return (
    <div className="relative w-8 h-8 flex items-center justify-center">
      <Cpu className="w-4 h-4 text-primary/70 relative z-10" />
      {[0, 1].map(i => (
        <motion.div
          key={i}
          className="absolute inset-0 rounded-full border border-primary/20"
          animate={{ scale: [0.8, 1.6], opacity: [0.6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.7 }}
        />
      ))}
    </div>
  )
}

function SubItemView({ item }: { item: SubItem }) {
  if (item.type === 'text') {
    if (!item.content && item.streaming) return null
    return (
      <div className="text-[10px] text-foreground/80 whitespace-pre-wrap break-words">
        {item.content}
        {item.streaming && (
          <motion.span
            className="inline-block w-[5px] h-[11px] bg-primary/60 ml-0.5 align-middle"
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          />
        )}
      </div>
    )
  }

  if (item.type === 'thinking') {
    if (!item.content) return null
    return (
      <div className="flex items-start gap-1.5">
        <Brain className="w-3 h-3 text-muted-foreground/40 mt-0.5 shrink-0" />
        <div className="text-[9px] text-muted-foreground/50 italic whitespace-pre-wrap break-words line-clamp-3">
          {item.content?.slice(0, 500)}
          {item.streaming && "..."}
        </div>
      </div>
    )
  }

  if (item.type === 'tool_use') {
    const Icon = SUB_TOOL_ICONS[item.name || ''] || Wrench
    const detail = (() => {
      const p = safeParse(item.input || '')
      return p.command?.split('\n')[0] || p.file_path || p.pattern || p.query || p.description || ''
    })()
    const done = !item.streaming && item.output != null
    return (
      <div className="flex items-center gap-1.5 text-[9px]">
        <Icon className={`w-3 h-3 shrink-0 ${item.is_error ? 'text-destructive/70' : done ? 'text-muted-foreground/50' : 'text-primary/50'}`} />
        <span className="text-muted-foreground/70 font-medium">{item.name}</span>
        <span className="text-muted-foreground/40 truncate flex-1">{detail}</span>
        {item.streaming && (
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-primary/50 shrink-0"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        )}
        {done && (
          <span className={`shrink-0 ${item.is_error ? 'text-destructive/50' : 'text-success/50'}`}>
            {item.is_error ? '✗' : '✓'}
          </span>
        )}
      </div>
    )
  }

  return null
}

export function TaskStream({ input, output, isError, streaming, subItems }: ToolUIProps) {
  const parsed = safeParse(input)
  const items = (subItems || []) as SubItem[]

  const agentType = parsed.subagent_type || "agent"
  const description = parsed.description || ""
  const agentName = parsed.name || ""
  const bg = parsed.run_in_background
  const done = !streaming && output != null
  const hasSubContent = items.length > 0

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-base)]">
      <div className="flex items-center gap-3 px-3 py-2.5">
        {streaming ? <BrainPulse /> : (
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className={`w-4 h-4 ${done && !isError ? 'text-success' : done && isError ? 'text-destructive' : 'text-primary/60'}`} />
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-foreground/80 font-medium">{agentName || agentType}</span>
            {agentName && agentType !== agentName && (
              <span className="text-[9px] text-muted-foreground/40">{agentType}</span>
            )}
            {bg && (
              <span className="text-[9px] text-warning/70 bg-warning/10 px-1 py-0.5 rounded border border-warning/15">bg</span>
            )}
          </div>
          {description && (
            <motion.div
              className="text-[10px] text-muted-foreground/60 truncate"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {description}
            </motion.div>
          )}
          {streaming && !hasSubContent && (
            <motion.div
              className="flex items-center gap-1 text-[9px] text-primary/60"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Zap className="w-2.5 h-2.5" />
              working...
              <ElapsedTime running={true} />
            </motion.div>
          )}
        </div>

        {done && (
          <motion.span
            className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
              isError ? 'text-destructive bg-destructive/10' : 'text-success bg-success/10'
            }`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {isError ? "failed" : "done"}
          </motion.span>
        )}
      </div>

      {/* subagent live stream */}
      {hasSubContent && (
        <div className="border-t border-border/20 px-3 py-2 space-y-1.5 max-h-[300px] overflow-auto">
          {items.map((item, i) => (
            <SubItemView key={i} item={item} />
          ))}
        </div>
      )}

      {/* final output (shown when done and no subItems rendered it) */}
      <AnimatePresence>
        {output && !hasSubContent && (
          <motion.div
            className="border-t border-border/20 max-h-[200px] overflow-auto"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
          >
            <pre className={`px-3 py-2 text-[10px] font-mono whitespace-pre-wrap ${
              isError ? 'text-destructive' : 'text-muted-foreground'
            }`}>
              {output.slice(0, 3000)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
