import { ReadTool } from "./ReadTool"
import { WriteTool } from "./WriteTool"
import { EditTool } from "./EditTool"
import { BashTool } from "./BashTool"
import { GlobTool } from "./GlobTool"
import { GrepTool } from "./GrepTool"
import { WebFetchTool } from "./WebFetchTool"
import { WebSearchTool } from "./WebSearchTool"
import { ScreenshotTool } from "./ScreenshotTool"
import { MessageTool } from "./MessageTool"
import { BrowserTool } from "./BrowserTool"
import { CronTool } from "./CronTool"
import { TaskTool } from "./TaskTool"
import { DefaultTool } from "./DefaultTool"

export type ToolUIProps = {
  name: string
  input: string // raw JSON string
  output?: string
  imageData?: string // base64 data URI for images
  isError?: boolean
  streaming?: boolean
}

const TOOL_MAP: Record<string, React.ComponentType<ToolUIProps>> = {
  Read: ReadTool,
  Write: WriteTool,
  Edit: EditTool,
  Bash: BashTool,
  Glob: GlobTool,
  Grep: GrepTool,
  WebFetch: WebFetchTool,
  WebSearch: WebSearchTool,
  screenshot: ScreenshotTool,
  message: MessageTool,
  browser: BrowserTool,
  schedule_reminder: CronTool,
  schedule_recurring: CronTool,
  schedule_cron: CronTool,
  list_reminders: CronTool,
  cancel_reminder: CronTool,
  Task: TaskTool,
}

export function ToolUI(props: ToolUIProps) {
  const Component = TOOL_MAP[props.name] || DefaultTool
  return <Component {...props} />
}
