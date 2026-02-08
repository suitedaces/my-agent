import type { ToolUIProps } from "./index"
import { Camera } from "lucide-react"

export function ScreenshotTool({ input, output, imageData, isError }: ToolUIProps) {
  const imgSrc = imageData || (output && output.startsWith("data:") ? output : undefined)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Camera className="w-3.5 h-3.5 text-primary" />
        <span className="text-muted-foreground">screenshot captured</span>
      </div>
      {imgSrc && !isError && (
        <div className="rounded-md border border-border overflow-hidden">
          <img src={imgSrc} alt="Screenshot" className="w-full" />
        </div>
      )}
      {output && !imgSrc && (
        <pre className="p-2 text-[11px] font-mono text-muted-foreground">{output.slice(0, 500)}</pre>
      )}
    </div>
  )
}
