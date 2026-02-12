import { motion, AnimatePresence } from "motion/react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"
import { ElapsedTime } from "./ElapsedTime"

export function TerminalStream({ input, output, isError, streaming }: ToolUIProps) {
  const parsed = safeParse(input)

  const command = parsed.command || input.slice(0, 300)
  const bg = parsed.run_in_background
  const done = !streaming && output != null

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-deep)] font-mono relative">
      {/* scanline overlay */}
      {streaming && (
        <div
          className="absolute inset-0 pointer-events-none z-10 opacity-[0.03]"
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.1) 1px, rgba(255,255,255,0.1) 2px)",
          }}
        />
      )}

      {/* title bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--stream-raised)] border-b border-border/30">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-destructive/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-warning/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-success/70" />
        </div>
        <span className="text-[10px] text-muted-foreground/60 ml-2">terminal</span>
        <ElapsedTime running={!!streaming} />
        {bg && (
          <motion.span
            className="text-[9px] text-warning/80 ml-auto px-1.5 py-0.5 rounded bg-warning/10 border border-warning/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            background
          </motion.span>
        )}
        {done && (
          <motion.span
            className={`text-[9px] ml-auto px-1.5 py-0.5 rounded border ${
              isError
                ? 'text-destructive/80 bg-destructive/10 border-destructive/20'
                : 'text-success/80 bg-success/10 border-success/20'
            }`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {isError ? "exit 1" : "exit 0"}
          </motion.span>
        )}
      </div>

      {/* command */}
      <div className="px-3 py-2">
        <div className="flex gap-2 text-[11px] leading-relaxed">
          <motion.span
            className="text-success shrink-0 select-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            $
          </motion.span>
          <span className="text-foreground/90 break-all">
            {command}
            {streaming && !output && (
              <motion.span
                className="inline-block w-[6px] h-[14px] bg-success/80 ml-0.5 align-middle"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              />
            )}
          </span>
        </div>
      </div>

      {/* output */}
      <AnimatePresence>
        {output && (
          <motion.div
            className="border-t border-border/20 max-h-[200px] overflow-auto"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <pre className={`px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap ${
              isError ? 'text-destructive/80' : 'text-muted-foreground'
            }`}>
              {output.slice(0, 3000)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>

      {/* bottom glow when running */}
      {streaming && (
        <motion.div
          className="h-[1px] bg-gradient-to-r from-transparent via-success/50 to-transparent"
          animate={{ opacity: [0.3, 0.8, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
    </div>
  )
}
