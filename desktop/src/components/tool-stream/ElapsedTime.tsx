import { useState, useEffect, useRef } from "react"

export function ElapsedTime({ running }: { running: boolean }) {
  const [ms, setMs] = useState(0)
  const start = useRef(Date.now())

  useEffect(() => {
    if (!running) return
    start.current = Date.now()
    const id = setInterval(() => setMs(Date.now() - start.current), 100)
    return () => clearInterval(id)
  }, [running])

  if (!running && ms === 0) return null

  const secs = ms / 1000
  const display = secs < 10 ? secs.toFixed(1) : Math.round(secs).toString()

  return (
    <span className="text-[9px] text-muted-foreground/40 tabular-nums">{display}s</span>
  )
}
