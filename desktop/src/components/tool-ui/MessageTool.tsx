import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { MessageSquare } from "lucide-react"

export function MessageTool({ input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const channel = parsed.channel || "unknown"
  const target = parsed.target || ""
  const message = parsed.message || ""
  const action = parsed.action || "send"

  const channelImg = channel === "whatsapp" ? "/whatsapp.png" : channel === "telegram" ? "/telegram.png" : null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        {channelImg ? <img src={channelImg} className="w-3.5 h-3.5" alt={channel} /> : <MessageSquare className="w-3.5 h-3.5 text-success" />}
        <span className="text-muted-foreground truncate">{target}</span>
        <Badge variant={isError ? "destructive" : "outline"} className="text-[9px] h-4 ml-auto">
          {action === "send" ? (isError ? "failed" : "sent") : action}
        </Badge>
      </div>
      {message && (
        <div className="rounded-md bg-primary/5 border border-primary/10 px-3 py-2 text-[11px] text-foreground">
          {message.slice(0, 500)}
        </div>
      )}
    </div>
  )
}
