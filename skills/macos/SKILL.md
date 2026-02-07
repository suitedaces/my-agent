---
name: macos
description: "Control macOS via AppleScript/osascript. Manage windows (move, resize, tile), apps (launch, quit, focus), system (volume, dark mode, notifications), Spotify, browsers, Calendar, Reminders, Finder, and clipboard. Use when the user asks to control their Mac, arrange windows, manage apps, or interact with native macOS features."
metadata:
  { "requires": { "bins": ["osascript"] } }
---

# macOS Automation Skill

Control macOS apps, windows, and system features via `osascript` through the Bash tool. All commands run AppleScript one-liners.

**Permissions:** Window management and UI scripting require Accessibility permission for Terminal/iTerm2 (System Settings > Privacy & Security > Accessibility). App control, volume, notifications, Spotify, browsers, Calendar, Reminders, and Finder work without it.

---

## Window Management

> Requires Accessibility permission

### Get screen size

```bash
osascript -e 'tell application "Finder" to get bounds of window of desktop'
# Returns: 0, 0, 1920, 1080 (x1, y1, x2, y2)
```

### Get window bounds

```bash
# Frontmost app's front window
osascript -e 'tell application "System Events" to tell (first process whose frontmost is true) to get {position, size} of window 1'

# Specific app
osascript -e 'tell application "Safari" to get bounds of front window'
```

### Move / resize

```bash
# Set bounds: {x1, y1, x2, y2}
osascript -e 'tell application "Safari" to set bounds of front window to {0, 25, 960, 1080}'

# Using System Events (works for any app)
osascript -e 'tell application "System Events" to tell process "Safari" to set position of window 1 to {100, 100}'
osascript -e 'tell application "System Events" to tell process "Safari" to set size of window 1 to {800, 600}'
```

### Tile left / right half

```bash
# Left half (1920x1080 screen, 25px menu bar)
osascript -e 'tell application "Safari" to set bounds of front window to {0, 25, 960, 1080}'

# Right half
osascript -e 'tell application "Google Chrome" to set bounds of front window to {960, 25, 1920, 1080}'
```

### Dynamic tiling (auto-detect screen size)

```bash
osascript -e '
tell application "Finder" to set screenBounds to bounds of window of desktop
set W to item 3 of screenBounds
set H to item 4 of screenBounds
tell application "Safari" to set bounds of front window to {0, 25, W / 2, H}
tell application "Google Chrome" to set bounds of front window to {W / 2, 25, W, H}
'
```

### Minimize / restore

```bash
osascript -e 'tell application "Safari" to set miniaturized of window 1 to true'
osascript -e 'tell application "Safari" to set miniaturized of window 1 to false'
```

### List all windows

```bash
osascript -e 'tell application "System Events" to get {name, position, size} of every window of every process whose visible is true'
```

### Focus a window by title

```bash
osascript -e 'tell application "Safari" to activate' -e 'tell application "Safari" to set index of window "Page Title" to 1'
```

---

## App Management

### Launch / activate (bring to front)

```bash
osascript -e 'tell application "Safari" to activate'
```

### Quit

```bash
osascript -e 'tell application "Safari" to quit'

# Only if running
osascript -e 'tell application "Safari" to if it is running then quit'
```

### Hide

```bash
osascript -e 'tell application "System Events" to set visible of process "Safari" to false'
```

### List running GUI apps

```bash
osascript -e 'tell application "System Events" to get name of every process whose background only is false'
```

### Check if app is running

```bash
osascript -e 'application "Safari" is running'
# Returns: true / false
```

### Get frontmost app

```bash
osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'
```

---

## System Controls

### Volume

```bash
# Get volume (0-100)
osascript -e 'output volume of (get volume settings)'

# Set volume
osascript -e 'set volume output volume 50'

# Mute / unmute
osascript -e 'set volume output muted true'
osascript -e 'set volume output muted false'

# Check mute status
osascript -e 'output muted of (get volume settings)'
```

### Dark mode

```bash
# Get status
osascript -e 'tell application "System Events" to tell appearance preferences to get dark mode'

# Toggle
osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to not dark mode'

# Set explicitly
osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to true'
```

### Notifications

```bash
# Simple
osascript -e 'display notification "Done!" with title "Agent" sound name "Glass"'

# With subtitle
osascript -e 'display notification "Build succeeded" with title "CI" subtitle "main branch" sound name "Purr"'
```

### Dialog / alert (blocks until dismissed)

```bash
# Alert
osascript -e 'display alert "Heads up" message "Deployment starting in 5 minutes"'

# Input dialog
osascript -e 'display dialog "Enter name:" default answer ""'
# Returns: button returned:OK, text returned:...
```

---

## Spotify

> Spotify must be running. These do NOT require Accessibility permission.

```bash
# Play / pause / next / prev
osascript -e 'tell application "Spotify" to playpause'
osascript -e 'tell application "Spotify" to next track'
osascript -e 'tell application "Spotify" to previous track'

# Current track info
osascript -e 'tell application "Spotify" to get {name of current track, artist of current track, album of current track}'

# Player state: playing / paused / stopped
osascript -e 'tell application "Spotify" to player state'

# Volume (0-100)
osascript -e 'tell application "Spotify" to sound volume'
osascript -e 'tell application "Spotify" to set sound volume to 60'

# Shuffle / repeat toggle
osascript -e 'tell application "Spotify" to set shuffling to not shuffling'
osascript -e 'tell application "Spotify" to set repeating to not repeating'

# Seek to position (seconds)
osascript -e 'tell application "Spotify" to set player position to 30'
```

---

## Browser Control

### Safari

```bash
# Current tab URL / title
osascript -e 'tell application "Safari" to return URL of front document'
osascript -e 'tell application "Safari" to return name of front document'

# Open URL
osascript -e 'tell application "Safari" to open location "https://example.com"'

# List all tab URLs in front window
osascript -e 'tell application "Safari" to get URL of every tab of front window'

# Close current tab
osascript -e 'tell application "Safari" to close current tab of front window'

# Execute JavaScript
osascript -e 'tell application "Safari" to do JavaScript "document.title" in front document'
```

### Google Chrome

```bash
# Current tab URL / title
osascript -e 'tell application "Google Chrome" to return URL of active tab of front window'
osascript -e 'tell application "Google Chrome" to return title of active tab of front window'

# Open URL
osascript -e 'tell application "Google Chrome" to open location "https://example.com"'

# List all tab URLs in front window
osascript -e 'tell application "Google Chrome" to get URL of every tab of front window'

# Close current tab
osascript -e 'tell application "Google Chrome" to close active tab of front window'

# Execute JavaScript
osascript -e 'tell application "Google Chrome" to execute active tab of front window javascript "document.title"'
```

---

## Calendar

```bash
# Get today's events from a calendar
osascript -e '
tell application "Calendar"
    set startDate to (current date)
    set time of startDate to 0
    set endDate to startDate + (1 * days)
    set evts to every event of calendar "Home" whose start date >= startDate and start date < endDate
    set output to {}
    repeat with e in evts
        set end of output to (summary of e) & " @ " & (start date of e as text)
    end repeat
    return output
end tell'

# Create event
osascript -e '
tell application "Calendar"
    tell calendar "Work"
        set startDate to date "Monday, January 15, 2026 at 2:00:00 PM"
        set endDate to startDate + (1 * hours)
        make new event at end with properties {summary:"Meeting", start date:startDate, end date:endDate}
    end tell
end tell'

# List calendar names
osascript -e 'tell application "Calendar" to get name of every calendar'
```

---

## Reminders

```bash
# Create reminder
osascript -e 'tell application "Reminders" to tell list "Reminders" to make new reminder with properties {name:"Buy groceries"}'

# Create with due date (tomorrow)
osascript -e 'tell application "Reminders" to tell list "Reminders" to make new reminder with properties {name:"Call dentist", due date:(current date) + (1 * days)}'

# List incomplete reminders
osascript -e 'tell application "Reminders" to get name of every reminder of list "Reminders" whose completed is false'

# Complete a reminder
osascript -e 'tell application "Reminders" to set completed of (first reminder of list "Reminders" whose name is "Buy groceries") to true'

# List reminder lists
osascript -e 'tell application "Reminders" to get name of every list'
```

---

## Finder

```bash
# Open folder
osascript -e 'tell application "Finder" to open (POSIX file "/Users/ishan/Documents")'

# Reveal file (select in Finder)
osascript -e 'tell application "Finder" to reveal (POSIX file "/Users/ishan/file.txt")' -e 'tell application "Finder" to activate'

# Get current Finder selection (POSIX paths)
osascript -e 'tell application "Finder"
    set sel to selection
    set paths to {}
    repeat with f in sel
        set end of paths to POSIX path of (f as alias)
    end repeat
    return paths
end tell'

# Get frontmost Finder window path
osascript -e 'tell application "Finder" to return POSIX path of (target of window 1 as alias)'

# Close all Finder windows
osascript -e 'tell application "Finder" to close every window'
```

---

## Clipboard

Prefer `pbcopy`/`pbpaste` (faster, no permissions needed):

```bash
# Read
pbpaste

# Write
echo "text" | pbcopy

# Via osascript (alternative)
osascript -e 'the clipboard as text'
osascript -e 'set the clipboard to "Hello"'
```

---

## UI Scripting (System Events)

> Requires Accessibility permission. Use as a last resort when apps lack native AppleScript support.

```bash
# Click a menu item
osascript -e 'tell application "System Events" to tell process "Safari" to click menu item "New Tab" of menu "File" of menu bar 1'

# Press keyboard shortcut
osascript -e 'tell application "System Events" to keystroke "s" using command down'
osascript -e 'tell application "System Events" to keystroke "n" using {command down, shift down}'

# Press special keys (Enter=36, Escape=53, Tab=48, Space=49)
osascript -e 'tell application "System Events" to key code 36'

# Fill text field
osascript -e 'tell application "System Events" to tell process "Safari" to set value of text field 1 of window 1 to "hello"'

# List UI elements (for discovery)
osascript -e 'tell application "System Events" to tell process "Safari" to get every UI element of window 1'
```

---

## Workspace Presets

Combine commands for common layouts. Example — coding workspace on a 1920x1080 screen:

```bash
# VS Code left 60%, browser right 40%
osascript -e '
tell application "Finder" to set sb to bounds of window of desktop
set W to item 3 of sb
set H to item 4 of sb
tell application "Code" to activate
tell application "System Events" to tell process "Code" to set position of window 1 to {0, 25}
tell application "System Events" to tell process "Code" to set size of window 1 to {W * 0.6, H - 25}
tell application "Safari" to activate
tell application "Safari" to set bounds of front window to {W * 0.6, 25, W, H}
'
```

---

## Tips

- **Quoting:** Double-escape single quotes in bash: `osascript -e 'tell app "Finder" to ...'`
- **Multi-line:** Use multiple `-e` flags or a heredoc: `osascript <<'EOF' ... EOF`
- **Errors:** If an app isn't running, `tell application "X" to activate` will launch it first
- **Performance:** Batch commands in one `osascript` call with multiple `tell` blocks instead of calling `osascript` repeatedly
- **Discovery:** To find what an app supports: `osascript -e 'tell application "AppName" to get properties'` or check its scripting dictionary in Script Editor
