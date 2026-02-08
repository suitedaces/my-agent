import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Monitor } from "lucide-react"

export function BrowserTool({ input, output, imageData, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const action = parsed.action || "unknown"
  const url = parsed.url || ""
  const text = parsed.text || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Monitor className="w-3.5 h-3.5 text-primary" />
        <Badge variant="outline" className="text-[9px] h-4">{action}</Badge>
        {url && <span className="text-primary text-[11px] truncate">{url}</span>}
        {text && <span className="text-muted-foreground text-[11px] truncate">"{text}"</span>}
      </div>
      {imageData && (
        <div className="rounded-md border border-border overflow-hidden">
          <img src={imageData} alt="Browser screenshot" className="w-full" />
        </div>
      )}
      {output && (
        <ScrollArea className="max-h-[200px] rounded-md bg-background border border-border">
          <pre className={`p-2 text-[11px] font-mono whitespace-pre-wrap ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {output.slice(0, 3000)}
          </pre>
        </ScrollArea>
      )}
    </div>
  )
}
