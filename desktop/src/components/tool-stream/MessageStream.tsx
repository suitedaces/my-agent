import { motion, AnimatePresence } from "motion/react"
import { Check, CheckCheck, Clock } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  )
}

export function MessageStream({ input, output, isError, streaming }: ToolUIProps) {
  const parsed = safeParse(input)

  const channel = parsed.channel || ""
  const target = parsed.target || ""
  const message = parsed.message || ""
  const action = parsed.action || "send"
  const done = !streaming && output != null

  const isWhatsapp = channel === "whatsapp"
  const isTelegram = channel === "telegram"

  const bubbleBg = isWhatsapp
    ? "bg-[var(--stream-bubble-wa)]"
    : isTelegram
      ? "bg-[var(--stream-bubble-tg)]"
      : "bg-[var(--stream-bubble-default)]"

  const accentColor = isWhatsapp
    ? "text-[oklch(0.70_0.15_155)]"
    : isTelegram
      ? "text-[oklch(0.70_0.12_250)]"
      : "text-primary"

  const channelImg = isWhatsapp ? "./whatsapp.png" : isTelegram ? "./telegram.png" : null

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-base)]">
      {/* chat header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--stream-raised)] border-b border-border/30">
        {channelImg ? (
          <img src={channelImg} className="w-4 h-4" alt={channel} />
        ) : (
          <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-[8px] text-primary">D</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-foreground/90 font-medium truncate">{target || "..."}</div>
          {streaming && (
            <motion.div
              className={`text-[9px] ${accentColor}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {action === "send" ? "typing..." : action}
            </motion.div>
          )}
        </div>
        {channel && (
          <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">{channel}</span>
        )}
      </div>

      {/* chat area */}
      <div className="px-3 py-3 min-h-[48px]">
        <AnimatePresence mode="wait">
          {!message && streaming ? (
            <motion.div
              key="typing"
              className={`inline-flex rounded-2xl rounded-bl-sm px-3 py-2 ${bubbleBg}`}
              initial={{ opacity: 0, scale: 0.9, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <TypingDots />
            </motion.div>
          ) : message ? (
            <motion.div
              key="message"
              className={`inline-block rounded-2xl rounded-bl-sm px-3 py-2 max-w-[90%] ${bubbleBg}`}
              initial={{ opacity: 0, scale: 0.9, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
            >
              <div className="text-[12px] text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
                {message.slice(0, 500)}
                {streaming && (
                  <motion.span
                    className="inline-block w-[2px] h-3 bg-foreground/60 ml-0.5 align-middle"
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                  />
                )}
              </div>
              {/* timestamp + delivery status */}
              <div className="flex items-center justify-end gap-1 mt-1">
                <span className="text-[9px] text-foreground/30">
                  {new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}
                </span>
                {streaming ? (
                  <Clock className="w-2.5 h-2.5 text-foreground/25" />
                ) : done && !isError ? (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    <CheckCheck className={`w-2.5 h-2.5 ${accentColor}`} />
                  </motion.div>
                ) : done && isError ? (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    <span className="text-[9px] text-destructive">!</span>
                  </motion.div>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
