"use client"

import { useState } from "react"
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from "motion/react"
import { cn } from "@/lib/utils"

export function FloatingNavbar({
  navItems,
  className,
  logo,
  action,
}: {
  navItems: { name: string; link: string }[]
  className?: string
  logo?: React.ReactNode
  action?: React.ReactNode
}) {
  const { scrollY } = useScroll()
  const [visible, setVisible] = useState(true)
  const [atTop, setAtTop] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)

  useMotionValueEvent(scrollY, "change", (current) => {
    const previous = scrollY.getPrevious() ?? 0
    if (current < 50) {
      setVisible(true)
      setAtTop(true)
    } else {
      setAtTop(false)
      if (current < previous) {
        setVisible(true)
      } else {
        setVisible(false)
        setMobileOpen(false)
      }
    }
  })

  return (
    <AnimatePresence mode="wait">
      <motion.nav
        initial={{ opacity: 1, y: 0 }}
        animate={{ y: visible ? 0 : -100, opacity: visible ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          "fixed top-0 inset-x-0 z-[5000]",
          !atTop && "backdrop-blur-xl bg-bg/80",
          mobileOpen && "backdrop-blur-xl bg-bg/80",
          "border-b transition-colors duration-300",
          atTop && !mobileOpen ? "border-transparent" : "border-border",
          className
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          {logo}
          {/* desktop nav */}
          <div className="hidden sm:flex items-center gap-6">
            {navItems.map((item) => (
              <a
                key={item.name}
                href={item.link}
                className="text-sm text-text-secondary hover:text-text transition-colors"
              >
                {item.name}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {action}
            {/* hamburger */}
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="sm:hidden flex flex-col gap-1.5 p-2 -mr-2"
              aria-label="Toggle menu"
            >
              <span className={cn("block h-0.5 w-5 bg-text transition-all duration-200", mobileOpen && "rotate-45 translate-y-[4px]")} />
              <span className={cn("block h-0.5 w-5 bg-text transition-all duration-200", mobileOpen && "opacity-0")} />
              <span className={cn("block h-0.5 w-5 bg-text transition-all duration-200", mobileOpen && "-rotate-45 -translate-y-[4px]")} />
            </button>
          </div>
        </div>
        {/* mobile dropdown */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="sm:hidden overflow-hidden border-t border-border"
            >
              <div className="flex flex-col gap-1 px-6 py-4">
                {navItems.map((item) => (
                  <a
                    key={item.name}
                    href={item.link}
                    onClick={() => setMobileOpen(false)}
                    className="py-2.5 text-sm text-text-secondary hover:text-text transition-colors"
                  >
                    {item.name}
                  </a>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>
    </AnimatePresence>
  )
}
