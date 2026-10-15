// Drop-in replacement for fs.watch(root, { recursive: true }) on platforms that
// don't support it (Linux / Android throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM).
//
// It exposes the same surface server.js relies on: a watcher object with .close().
// public-view.html only reacts to "somebody changed something" (it reloads), so the
// event granularity here does not need to match inotify.

const fs = require('fs')
const path = require('path')

const DEFAULT_INTERVAL = Number(process.env.XPOSEDIR_POLL_MS || 2000)

function scan(root) {
  const out = new Map()
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        out.set(full + path.sep, 'dir')
        stack.push(full)
      } else if (e.isFile()) {
        let st
        try {
          st = fs.statSync(full)
        } catch {
          continue
        }
        out.set(full, st.size + ':' + st.mtimeMs)
      }
    }
  }
  return out
}

function startPollingWatch(root, listener) {
  let previous = scan(root)
  const timer = setInterval(() => {
    let next
    try {
      next = scan(root)
    } catch {
      return
    }
    for (const [file, signature] of next) {
      if (previous.get(file) !== signature) listener('change', file)
    }
    for (const file of previous.keys()) {
      if (!next.has(file)) listener('rename', file)
    }
    previous = next
  }, DEFAULT_INTERVAL)
  // Don't hold the event loop open on its own.
  if (typeof timer.unref === 'function') timer.unref()
  return {
    close() {
      clearInterval(timer)
    }
  }
}

module.exports = { startPollingWatch }