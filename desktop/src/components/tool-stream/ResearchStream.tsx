import { motion } from "motion/react"
import { FileSearch, FilePlus, Pencil, Link2, Tag } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"

const TOOL_META: Record<string, { icon: typeof FileSearch; verb: string; color: string }> = {
  research_view: { icon: FileSearch, verb: "viewing research", color: "text-blue-400" },
  research_add: { icon: FilePlus, verb: "adding research", color: "text-emerald-400" },
  research_update: { icon: Pencil, verb: "updating research", color: "text-amber-400" },
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-blue-500",
  completed: "bg-emerald-500",
  archived: "bg-muted-foreground",
}

function parseIdFromOutput(output?: string): string {
  if (!output) return ""
  const m = output.match(/Research #(\d+)/)
  return m?.[1] || ""
}

export function ResearchStream({ name, input, output, isError, streaming }: ToolUIProps) {
  const parsed = safeParse(input)
  const meta = TOOL_META[name] || TOOL_META.research_view
  const Icon = meta.icon
  const done = !streaming && output != null

  const id = parsed.id || parseIdFromOutput(output)
  const title = parsed.title || ""
  const topic = parsed.topic || ""
  const status = parsed.status || ""
  const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t: unknown) => String(t)) : []
  const sourceCount = Array.isArray(parsed.sources) ? parsed.sources.length : 0

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-base)]">
      <div className="px-3 py-2.5 border-b border-border/20">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
          <span className={`text-[10px] uppercase tracking-wider font-medium ${meta.color}`}>{meta.verb}</span>
          {done && (
            <motion.span
              className={`text-[9px] ml-auto px-1.5 py-0.5 rounded ${isError ? "text-destructive bg-destructive/10" : "text-success bg-success/10"}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              {isError ? "failed" : "done"}
            </motion.span>
          )}
        </div>
      </div>

      <div className="px-3 py-2 space-y-2">
        {(id || title || topic || status) && (
          <div className="space-y-1">
            {(id || title) && (
              <div className="flex items-center gap-1.5 text-[11px]">
                {id && <code className="text-muted-foreground/60">#{id}</code>}
                {title && <span className="text-foreground/85 truncate">{title}</span>}
              </div>
            )}
            {(topic || status) && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
                {topic && <span className="truncate">topic: {topic}</span>}
                {status && (
                  <span className="inline-flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status] || "bg-muted-foreground"}`} />
                    <span>{status}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {(tags.length > 0 || sourceCount > 0) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {tags.slice(0, 5).map((tag: string) => (
              <span key={tag} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-secondary border border-border/40">
                <Tag className="w-2.5 h-2.5 text-muted-foreground/60" />
                {tag}
              </span>
            ))}
            {sourceCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-secondary border border-border/40">
                <Link2 className="w-2.5 h-2.5 text-muted-foreground/60" />
                {sourceCount} source{sourceCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {streaming && !output && (
          <motion.div
            className="text-[10px] text-muted-foreground/60"
            animate={{ opacity: [0.45, 0.9, 0.45] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          >
            preparing research update...
          </motion.div>
        )}
      </div>

      {output && (
        <motion.div
          className="border-t border-border/20 px-3 py-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <pre className={`text-[10px] font-mono whitespace-pre-wrap ${isError ? "text-destructive" : "text-muted-foreground"}`}>
            {output.slice(0, 1800)}
          </pre>
        </motion.div>
      )}
    </div>
  )
}
