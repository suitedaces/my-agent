export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-3 text-sm text-text-muted">
          <img src="/dorabot.png" alt="dorabot" className="h-6 w-6" />
          dorabot
        </div>
        <div className="flex items-center gap-6 text-sm text-text-muted">
          <a
            href="https://github.com/suitedaces/dorabot"
            className="hover:text-text transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://twitter.com/ishanxnagpal"
            className="hover:text-text transition-colors"
          >
            Twitter
          </a>
          <span>MIT License</span>
        </div>
      </div>
    </footer>
  )
}
