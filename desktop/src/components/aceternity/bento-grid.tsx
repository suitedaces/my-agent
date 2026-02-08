import { cn } from "@/lib/utils"

export function BentoGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-3 grid-cols-1 md:grid-cols-2", className)}>
      {children}
    </div>
  )
}

export function BentoGridItem({ children, className, colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <div className={cn(
      "rounded-lg",
      colSpan === 2 && "md:col-span-2",
      className
    )}>
      {children}
    </div>
  )
}
