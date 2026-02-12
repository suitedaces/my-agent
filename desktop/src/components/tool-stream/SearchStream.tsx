import { motion, AnimatePresence } from "motion/react"
import { Search, Globe, ExternalLink } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"
import { ElapsedTime } from "./ElapsedTime"

function RadarPulse() {
  return (
    <div className="relative w-8 h-8">
      <Globe className="absolute inset-1.5 w-5 h-5 text-primary/60" />
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="absolute inset-0 rounded-full border border-primary/30"
          initial={{ scale: 0.5, opacity: 0.8 }}
          animate={{ scale: 1.8, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.6 }}
        />
      ))}
    </div>
  )
}

type SearchResult = { title: string; url: string }

function parseSearchResults(text: string): SearchResult[] {
  const results: SearchResult[] = []
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
  let match
  while ((match = linkRe.exec(text)) !== null) {
    results.push({ title: match[1], url: match[2] })
  }
  if (results.length > 0) return results.slice(0, 8)

  // fallback: lines that look like urls
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length && results.length < 8; i++) {
    const line = lines[i]
    if (line.startsWith("http://") || line.startsWith("https://")) {
      const title = i > 0 && !lines[i - 1].startsWith("http") ? lines[i - 1] : line
      results.push({ title, url: line })
    }
  }
  return results
}

export function SearchStream({ input, output, isError, streaming }: ToolUIProps) {
  const parsed = safeParse(input)

  const query = parsed.query || ""
  const done = !streaming && output != null

  const results = output && !isError ? parseSearchResults(output) : []

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-base)]">
      {/* search bar */}
      <div className="px-3 py-2.5 bg-[var(--stream-raised)]">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--stream-deep)] border border-border/30">
          <Search className={`w-3.5 h-3.5 shrink-0 ${streaming ? 'text-primary' : 'text-muted-foreground/60'}`} />
          <span className="text-[12px] text-foreground/80 truncate flex-1">
            {query || "..."}
            {streaming && query && (
              <motion.span
                className="inline-block w-[2px] h-3.5 bg-primary/80 ml-0.5 align-middle"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              />
            )}
          </span>
          {streaming && (
            <>
              <ElapsedTime running={true} />
              <motion.div
                className="w-3.5 h-3.5 rounded-full border-2 border-primary/50 border-t-primary"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
              />
            </>
          )}
        </div>
      </div>

      {/* content area */}
      <div className="px-3 py-3">
        <AnimatePresence mode="wait">
          {streaming && !output ? (
            <motion.div
              key="searching"
              className="flex flex-col items-center gap-3 py-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <RadarPulse />
              <motion.span
                className="text-[10px] text-muted-foreground/60"
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                searching the web...
              </motion.span>
            </motion.div>
          ) : output ? (
            <motion.div
              key="results"
              className="space-y-1"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {results.length > 0 ? (
                <>
                  <div className="text-[10px] text-muted-foreground/50 mb-2">{results.length} results</div>
                  <div className="space-y-1.5 max-h-[200px] overflow-auto">
                    {results.map((r, i) => (
                      <motion.div
                        key={i}
                        className="flex items-start gap-2 px-2 py-1.5 rounded bg-[var(--stream-deep)] border border-border/15"
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        <ExternalLink className="w-3 h-3 text-primary/40 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-[11px] text-foreground/80 truncate">{r.title}</div>
                          <div className="text-[9px] text-primary/50 truncate">{r.url}</div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </>
              ) : (
                <pre className={`text-[11px] font-mono whitespace-pre-wrap max-h-[200px] overflow-auto ${
                  isError ? 'text-destructive' : 'text-muted-foreground'
                }`}>
                  {output.slice(0, 3000)}
                </pre>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
