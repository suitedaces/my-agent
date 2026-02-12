import { motion, AnimatePresence } from "motion/react"
import { Camera, Aperture } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { ElapsedTime } from "./ElapsedTime"

function Viewfinder() {
  const corners = [
    { top: 0, left: 0, borderTop: true, borderLeft: true },
    { top: 0, right: 0, borderTop: true, borderRight: true },
    { bottom: 0, left: 0, borderBottom: true, borderLeft: true },
    { bottom: 0, right: 0, borderBottom: true, borderRight: true },
  ]

  return (
    <div className="relative w-full aspect-video">
      {corners.map((c, i) => (
        <motion.div
          key={i}
          className="absolute w-5 h-5"
          style={{
            top: c.top != null ? c.top : undefined,
            bottom: (c as any).bottom != null ? (c as any).bottom : undefined,
            left: c.left != null ? c.left : undefined,
            right: (c as any).right != null ? (c as any).right : undefined,
            borderTopWidth: c.borderTop ? 2 : 0,
            borderBottomWidth: c.borderBottom ? 2 : 0,
            borderLeftWidth: c.borderLeft ? 2 : 0,
            borderRightWidth: c.borderRight ? 2 : 0,
            borderColor: "oklch(0.70 0.15 250 / 0.6)",
          }}
          initial={{ opacity: 0, scale: 1.3 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.08, duration: 0.3 }}
        />
      ))}
      {/* center crosshair */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        animate={{ opacity: [0.3, 0.7, 0.3] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <Aperture className="w-6 h-6 text-primary/40" />
      </motion.div>
      {/* focus ring */}
      <motion.div
        className="absolute inset-[20%] rounded-full border border-primary/20"
        animate={{ scale: [1, 0.95, 1], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </div>
  )
}

export function ScreenshotStream({ input, output, imageData, isError, streaming }: ToolUIProps) {
  const imgSrc = imageData || (output && output.startsWith("data:") ? output : undefined)
  const done = !streaming && output != null

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-deep)]">
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--stream-mid)] border-b border-border/30">
        <Camera className={`w-3.5 h-3.5 ${streaming ? 'text-primary' : 'text-muted-foreground/60'}`} />
        <span className="text-[10px] text-muted-foreground/60">
          {streaming ? "capturing..." : done ? "captured" : "screenshot"}
        </span>
        {streaming && (
          <>
            <span className="flex-1" />
            <ElapsedTime running={true} />
            <motion.div
              className="w-2 h-2 rounded-full bg-destructive"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />
          </>
        )}
      </div>

      {/* content */}
      <div className="relative">
        <AnimatePresence mode="wait">
          {streaming && !imgSrc ? (
            <motion.div
              key="viewfinder"
              className="p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Viewfinder />
            </motion.div>
          ) : imgSrc ? (
            <motion.div key="image" className="relative">
              {/* flash effect */}
              <motion.div
                className="absolute inset-0 bg-white z-10 pointer-events-none"
                initial={{ opacity: 0.8 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
              />
              {/* image developing — starts slightly blurred */}
              <motion.img
                src={imgSrc}
                alt="screenshot"
                className="w-full"
                initial={{ filter: "blur(8px) brightness(1.2)", opacity: 0.7 }}
                animate={{ filter: "blur(0px) brightness(1)", opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              />
            </motion.div>
          ) : done && !imgSrc ? (
            <motion.div
              key="text"
              className="p-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <pre className={`text-[11px] font-mono whitespace-pre-wrap ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
                {(output || "").slice(0, 500)}
              </pre>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
