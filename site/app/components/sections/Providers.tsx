"use client"

import { motion } from "motion/react"
import { CardContainer, CardBody, CardItem } from "../aceternity/3d-card"
import { SectionPlayer } from "../remotion/SectionPlayer"
import { ProviderOrbit } from "../remotion/ProviderOrbit"

// Claude logo (Anthropic)
function ClaudeLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
      <path d="M16.604 3.276L12.926 15.13 7.327 3.276H4L11.38 20.724h3.092L21 3.276h-4.396z" fill="#D4A27F"/>
    </svg>
  )
}

// OpenAI logo
function OpenAILogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8 text-[#10A37F]">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
    </svg>
  )
}

// MiniMax logo (placeholder - stylized M)
function MiniMaxLogo() {
  return (
    <div className="flex items-center justify-center h-8 w-8 rounded-md bg-gradient-to-br from-yellow-400 to-orange-500 text-white font-bold text-sm">
      M
    </div>
  )
}

const providers = [
  {
    name: "Claude",
    badge: "Default",
    auth: "API key or Pro/Max subscription",
    sdk: "Claude Agent SDK",
    color: "oklch(0.72 0.18 250)",
    logo: <ClaudeLogo />,
  },
  {
    name: "OpenAI Codex",
    badge: null,
    auth: "API key or ChatGPT OAuth",
    sdk: "Codex SDK",
    color: "oklch(0.70 0.24 145)",
    logo: <OpenAILogo />,
  },
  {
    name: "MiniMax",
    badge: null,
    auth: "API key",
    sdk: "OpenAI-compatible API",
    color: "oklch(0.74 0.19 80)",
    logo: <MiniMaxLogo />,
  },
]

export function Providers() {
  return (
    <section className="relative px-6 py-20 sm:py-28 border-t border-border overflow-hidden">
      {/* Remotion background */}
      <SectionPlayer
        component={ProviderOrbit}
        opacity={0.3}
        compositionWidth={960}
        compositionHeight={540}
      />

      <div className="relative z-10 mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.4 }}
          className="text-center mb-14"
        >
          <h2 className="text-3xl font-bold sm:text-4xl lg:text-5xl tracking-tight">
            Pick the model you&apos;re already paying for
          </h2>
          <p className="mt-4 text-text-secondary text-base sm:text-lg max-w-2xl mx-auto">
            Multi-provider support. Switch from the desktop app or config.
          </p>
        </motion.div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <CardContainer containerClassName="w-full">
                <CardBody className="relative w-full rounded-lg border border-border bg-bg-card/50 glass p-6 sm:p-7 group/card">
                  <CardItem translateZ={40} className="w-full">
                    <div className="flex items-center gap-3 mb-4">
                      {p.logo}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-base sm:text-lg">{p.name}</h3>
                          {p.badge && (
                            <span className="rounded border border-accent/20 bg-accent/5 px-2 py-0.5 text-xs text-accent">
                              {p.badge}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardItem>
                  <CardItem translateZ={20} className="w-full">
                    <p className="text-sm sm:text-base text-text-secondary mb-1">{p.auth}</p>
                    <p className="text-xs sm:text-sm text-text-muted">{p.sdk}</p>
                  </CardItem>
                </CardBody>
              </CardContainer>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
