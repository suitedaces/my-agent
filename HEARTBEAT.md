# Heartbeat Checklist

This file is read by the agent on each heartbeat interval. Add tasks you want the agent to periodically check.

## Example Tasks

- Check email for urgent messages (use himalaya skill)
- Review calendar for events in next 2 hours
- Check GitHub notifications (use github skill)
- If idle for 8+ hours, send a brief check-in

## Notes

- Keep this file small to minimize token usage
- Remove completed one-time tasks
- If nothing needs attention, the agent will reply HEARTBEAT_OK (suppressed)
