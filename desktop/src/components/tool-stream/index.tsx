import { motion } from "motion/react"
import type { ToolUIProps } from "../tool-ui"
import { BrowserStream } from "./BrowserStream"
import { TerminalStream } from "./TerminalStream"
import { MessageStream } from "./MessageStream"
import { SearchStream } from "./SearchStream"
import { ScreenshotStream } from "./ScreenshotStream"
import { FileStream } from "./FileStream"
import { CronStream } from "./CronStream"
import { GoalsStream } from "./GoalsStream"
import { WebFetchStream } from "./WebFetchStream"
import { TaskStream } from "./TaskStream"
import { ResearchStream } from "./ResearchStream"

const STREAM_MAP: Record<string, React.ComponentType<ToolUIProps>> = {
  browser: BrowserStream,
  Bash: TerminalStream,
  message: MessageStream,
  WebSearch: SearchStream,
  WebFetch: WebFetchStream,
  screenshot: ScreenshotStream,
  Write: FileStream,
  Edit: FileStream,
  Task: TaskStream,
  schedule: CronStream,
  list_schedule: CronStream,
  update_schedule: CronStream,
  cancel_schedule: CronStream,
  goals_view: GoalsStream,
  goals_add: GoalsStream,
  goals_update: GoalsStream,
  goals_propose: GoalsStream,
  research_view: ResearchStream,
  research_add: ResearchStream,
  research_update: ResearchStream,
  // TodoWrite and AskUserQuestion handled inline — not as stream cards
}

function StreamProgress() {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden z-20 rounded-b-lg">
      <motion.div
        className="h-full bg-gradient-to-r from-transparent via-primary/50 to-transparent"
        style={{ width: "40%" }}
        initial={{ x: "-100%" }}
        animate={{ x: "250%" }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
      />
    </div>
  )
}

export function ToolStreamCard(props: ToolUIProps) {
  const Component = STREAM_MAP[props.name]
  if (!Component) return null
  return (
    <div className="relative">
      <Component {...props} />
      {props.streaming && <StreamProgress />}
    </div>
  )
}

export function hasStreamCard(toolName: string): boolean {
  return toolName in STREAM_MAP
}
