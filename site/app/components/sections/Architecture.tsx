"use client"

import { motion } from "motion/react"
import { SectionPlayer } from "../remotion/SectionPlayer"
import { ArchitectureFlow } from "../remotion/ArchitectureFlow"

export function Architecture() {
  return (
    <section id="architecture" className="relative px-6 py-20 sm:py-28 border-t border-border overflow-hidden">
      {/* Remotion background */}
      <SectionPlayer
        component={ArchitectureFlow}
        opacity={0.2}
        compositionWidth={960}
        compositionHeight={540}
      />

      <div className="relative z-10 mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.4 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl font-bold sm:text-4xl lg:text-5xl tracking-tight mb-4">Built for builders</h2>
          <p className="text-text-secondary text-base sm:text-lg max-w-2xl mx-auto">
            ~70 gateway RPCs. SQLite sessions. MCP tool system. Fully extensible.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5 }}
        >
          <div className="rounded-xl border border-border bg-surface-base/50 glass overflow-hidden">
            {/* Terminal chrome */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <div className="h-3 w-3 rounded-full bg-[oklch(0.65_0.24_27)]" />
              <div className="h-3 w-3 rounded-full bg-[oklch(0.74_0.19_80)]" />
              <div className="h-3 w-3 rounded-full bg-[oklch(0.70_0.24_145)]" />
              <span className="ml-2 text-xs text-text-muted">architecture</span>
            </div>
            <div className="p-5 sm:p-7">
              {/* desktop: full diagram */}
              <pre className="hidden sm:block text-xs sm:text-sm md:text-base text-text-secondary leading-relaxed overflow-x-auto">
                {`┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Desktop  │  │ Telegram │  │ WhatsApp │  │  Slack   │
│(Electron)│  │ (grammy) │  │(Baileys) │  │ (Bolt)   │
└────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │             │
     └─────────┬───┴─────────────┴─────┬───────┘
               │                       │
      ┌────────▼────────┐              │
      │  Gateway Server  │  WebSocket RPC
      │  Token-auth'd    │  Port 18789
      └────────┬────────┘
               │
      ┌────────▼────────┐
      │  Provider Layer  │  Claude / Codex / MiniMax
      │  Singleton init  │
      └────────┬────────┘
               │
  ┌────────────┼────────────┐
  │            │            │
┌─▼─────┐ ┌───▼─────┐ ┌───▼───┐
│ Tools │ │Sessions │ │ Cron  │
│ (MCP) │ │(SQLite) │ │ Sched │
└───────┘ └─────────┘ └───────┘`}
              </pre>
              {/* mobile: compact diagram */}
              <pre className="sm:hidden text-[11px] text-text-secondary leading-relaxed overflow-x-auto">
                {`Desktop · Telegram · WhatsApp · Slack
            │
    ┌───────▼────────┐
    │ Gateway Server │ WS :18789
    └───────┬────────┘
    ┌───────▼────────┐
    │ Provider Layer │ Claude/Codex
    └───────┬────────┘
       ┌────┼────┐
    Tools Sessions Cron
    (MCP) (SQLite)  Sched`}
              </pre>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
