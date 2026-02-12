import { motion, AnimatePresence } from "motion/react"
import { Globe, ArrowDown, FileText } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"
import { ElapsedTime } from "./ElapsedTime"

function DownloadWave() {
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[0, 1, 2, 3, 4].map(i => (
        <motion.div
          key={i}
          className="w-1 rounded-full bg-primary/50"
          animate={{ height: [4, 14, 4] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12 }}
        />
      ))}
    </div>
  )
}

function ContentPreview({ text }: { text: string }) {
  const lines = text.split("\n").filter(l => l.trim())
  const headings: string[] = []
  let firstParagraph = ""

  for (const line of lines) {
    const hMatch = line.match(/^#{1,3}\s+(.+)/)
    if (hMatch) {
      headings.push(hMatch[1])
    } else if (!firstParagraph && line.length > 30 && !line.startsWith("```") && !line.startsWith("|") && !line.startsWith("-")) {
      firstParagraph = line.slice(0, 200)
    }
    if (headings.length >= 4 && firstParagraph) break
  }

  if (headings.length === 0 && !firstParagraph) return null

  return (
    <div className="space-y-1.5">
      {headings.length > 0 && (
        <div className="space-y-1">
          {headings.map((h, i) => (
            <motion.div
              key={i}
              className="flex items-center gap-1.5"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <FileText className="w-2.5 h-2.5 text-primary/40 shrink-0" />
              <span className="text-[10px] text-foreground/70 truncate">{h}</span>
            </motion.div>
          ))}
        </div>
      )}
      {firstParagraph && (
        <div className="text-[10px] text-muted-foreground/50 leading-relaxed line-clamp-3">
          {firstParagraph}
        </div>
      )}
    </div>
  )
}

export function WebFetchStream({ input, output, isError, streaming }: ToolUIProps) {
  const parsed = safeParse(input)

  const url = parsed.url || ""
  const prompt = parsed.prompt || ""
  const done = !streaming && output != null

  let host = ""
  try { host = new URL(url).hostname } catch {}

  const hasStructuredPreview = output && !isError && (output.includes("#") || output.length > 100)

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-base)]">
      {/* url bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--stream-raised)] border-b border-border/30">
        <Globe className={`w-3.5 h-3.5 shrink-0 ${streaming ? 'text-primary' : 'text-muted-foreground/60'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px]">
            {host && <span className="text-foreground/70 font-medium">{host}</span>}
            {streaming && url && (
              <motion.span
                className="inline-block w-[2px] h-3 bg-primary/80"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              />
            )}
          </div>
          {url && host !== url && (
            <div className="text-[9px] text-muted-foreground/40 truncate">{url}</div>
          )}
        </div>
        {streaming && <><ElapsedTime running={true} /><DownloadWave /></>}
        {done && (
          <motion.span
            className={`text-[9px] px-1.5 py-0.5 rounded ${
              isError ? 'text-destructive bg-destructive/10' : 'text-success bg-success/10'
            }`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {isError ? "error" : "fetched"}
          </motion.span>
        )}
      </div>

      {/* prompt */}
      {prompt && (
        <motion.div
          className="px-3 py-1.5 border-b border-border/20 text-[10px] text-muted-foreground/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <span className="text-primary/50">prompt:</span> {prompt.slice(0, 150)}
        </motion.div>
      )}

      {/* loading state */}
      {streaming && !output && (
        <div className="px-3 py-4 flex flex-col items-center gap-2">
          <motion.div
            className="flex items-center gap-2 text-[10px] text-muted-foreground/50"
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <ArrowDown className="w-3 h-3" />
            fetching content...
          </motion.div>
        </div>
      )}

      {/* output */}
      <AnimatePresence>
        {output && (
          <motion.div
            className="max-h-[200px] overflow-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {hasStructuredPreview ? (
              <div className="px-3 py-2">
                <ContentPreview text={output} />
                <details className="mt-2">
                  <summary className="text-[9px] text-muted-foreground/40 cursor-pointer hover:text-muted-foreground/60">
                    raw output
                  </summary>
                  <pre className="mt-1 text-[10px] font-mono whitespace-pre-wrap leading-relaxed text-muted-foreground max-h-[120px] overflow-auto">
                    {output.slice(0, 3000)}
                  </pre>
                </details>
              </div>
            ) : (
              <pre className={`px-3 py-2 text-[10px] font-mono whitespace-pre-wrap leading-relaxed ${
                isError ? 'text-destructive' : 'text-muted-foreground'
              }`}>
                {output.slice(0, 3000)}
              </pre>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
