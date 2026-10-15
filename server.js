const express = require("express");
  const archiver = require('archiver')
// const { v2: webdav } = require('webdav-server')
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const tarArchive = require("./tar-archive");

let serverInstance = null;
let watcher = null;
let sseClients = [];
let currentPort = 3000;
let templateHtml = null;
let currentMode = "read";
let currentFolder = null;
let archiveJobs = new Map();

function loadTemplate() {
  if (!templateHtml) {
    templateHtml = fs.readFileSync(
      path.join(__dirname, "public-view.html"),
      "utf8",
    );
  }
  return templateHtml;
}
function getFolderSize(folderPath) {
  let total = 0;
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(folderPath, e.name);
      try {
        if (e.isDirectory()) {
          total += getFolderSize(full);
        } else {
          total += fs.statSync(full).size;
        }
      } catch {}
    }
  } catch {}
  return total;
}

function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function resolveItem(root, folderPath, item) {
  const full = path.resolve(path.join(folderPath, item));
  const rootLower = root.toLowerCase();
  const lower = full.toLowerCase();
  if (lower !== rootLower && !lower.startsWith(rootLower + path.sep)) return null;
  return full;
}

function archiveNameFor(folderPath, items) {
  const root = path.resolve(folderPath);
  for (const item of items) {
    const full = path.resolve(path.join(folderPath, item));
    if (full && full.toLowerCase() === root.toLowerCase()) {
      return (path.basename(root) || "xposedir") + ".tar";
    }
  }
  if (items.length === 1) {
    return (path.basename(items[0]) || "xposedir") + ".tar";
  }
  return "xposedir-download.tar";
}

// Builds a virtual, non-materialized TAR index for the given items.
// Returns job info; the archive bytes are never written to disk.
function prepareArchive(items) {
  if (!currentFolder) throw new Error("Server not started");
  let list = items;
  if (typeof items === "string") list = [items];
  if (!Array.isArray(list)) list = [];
  list = list.filter((i) => typeof i === "string" && i.trim());
  if (!list.length) throw new Error("No items");

  const root = path.resolve(currentFolder);
  for (const item of list) {
    if (!resolveItem(root, currentFolder, item)) throw new Error("Invalid path: " + item);
  }

  const jobId = crypto.randomUUID();
  const index = tarArchive.buildIndex(currentFolder, list);
  const name = archiveNameFor(currentFolder, list);
  archiveJobs.set(jobId, { index, name, createdAt: Date.now() });
  return { jobId, name, totalBytes: index.totalBytes, files: index.files, folders: index.folders };
}

function deleteArchive(jobId) {
  archiveJobs.delete(jobId);
}

async function start(folderPath, { mode = "read", port = 3000 } = {}) {
  currentPort = port;
  currentMode = mode;
  currentFolder = folderPath;
  if (serverInstance) {
    serverInstance.close();
    if (typeof serverInstance.closeAllConnections === "function")
      serverInstance.closeAllConnections();
    serverInstance = null;
  }
  if (watcher) watcher.close();
  sseClients = [];
  archiveJobs.clear();
  templateHtml = null; // resetea el template por si cambió

  const app = express();

  // SSE
  app.get("/__events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    sseClients.push(res);
    req.on("close", () => {
      sseClients = sseClients.filter((c) => c !== res);
    });
  });

  const multer = require("multer");

  // dentro de start(), después del endpoint /__events
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dest = path.join(
        folderPath,
        decodeURIComponent(req.query.path || "/"),
      );
      cb(null, dest);
    },
    filename: (req, file, cb) => cb(null, file.originalname),
  });
  const upload = multer({ storage });

  app.post("/__upload", upload.array("files"), (req, res) => {
    res.json({ ok: true });
  });

  app.post("/__mkdir", express.json(), (req, res) => {
    if (currentMode !== "write")
      return res.status(403).json({ error: "Read only" });
    const { path: dirPath, name } = req.body;
    if (!name || name.includes("/") || name.includes("..")) {
      return res.status(400).json({ error: "Invalid folder name" });
    }
    try {
      fs.mkdirSync(path.join(folderPath, dirPath, name));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });




app.post('/__download', express.json(), express.urlencoded({ extended: true }), (req, res) => {
  try {
    let items = req.body && req.body.items
    if (typeof items === 'string') items = [items]
    if (!Array.isArray(items)) items = []
    items = items.filter(i => typeof i === 'string' && i.trim())
    if (!items.length) return res.status(400).json({ error: 'No items' })

    const root = path.resolve(folderPath)
    const resolveItem = (item) => {
      const full = path.resolve(path.join(folderPath, item))
      const lower = full.toLowerCase()
      const rootLower = root.toLowerCase()
      if (lower !== rootLower && !lower.startsWith(rootLower + path.sep)) return null
      return full
    }

    // si es un solo archivo, descargalo directo
    if (items.length === 1) {
      const fullPath = resolveItem(items[0])
      if (!fullPath) return res.status(400).json({ error: 'Invalid path' })
      const stat = fs.statSync(fullPath)
      if (stat.isFile()) {
        return res.download(fullPath)
      }
    }

    // múltiples archivos o carpeta — zip
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="xposedir-download.zip"')

    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message })
      else res.destroy()
    })
    archive.pipe(res)

    items.forEach(item => {
      const fullPath = resolveItem(item)
      if (!fullPath) return
      try {
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          archive.directory(fullPath, path.basename(fullPath))
        } else {
          archive.file(fullPath, { name: path.basename(fullPath) })
        }
      } catch {}
    })

    archive.finalize()
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message })
    else res.destroy()
  }
})

// GET download for a single file — resumable (Range), for the browser button
app.get('/__download/', (req, res) => {
  try {
    let items = req.query.items
    if (typeof items === 'string') items = [items]
    if (!Array.isArray(items)) items = []
    items = items.filter(i => typeof i === 'string' && i.trim())
    if (items.length !== 1) return res.status(400).json({ error: 'Single item required (encode ?items=...) or use the tar endpoint' })
    const root = path.resolve(folderPath)
    const fullPath = resolveItem(root, folderPath, items[0])
    if (!fullPath) return res.status(400).json({ error: 'Invalid path' })
    const stat = fs.statSync(fullPath)
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file — use the tar endpoint for folders' })
    return res.download(fullPath)
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message })
    else res.destroy()
  }
})

// Start a virtual TAR job for a folder / multiple items (no disk usage)
app.post('/__prepare', express.json(), express.urlencoded({ extended: true }), (req, res) => {
  try {
    res.json(prepareArchive(req.body && req.body.items))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Stream (parts of) a prepared virtual TAR with byte ranges
app.get('/__archive/:jobId', async (req, res) => {
  const job = archiveJobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Unknown archive' })
  const total = job.index.totalBytes

  res.setHeader('Content-Type', 'application/x-tar')
  res.setHeader('Content-Disposition', `attachment; filename="${job.name}"`)
  res.setHeader('Accept-Ranges', 'bytes')

  let start = 0
  let end = total - 1
  const range = req.headers.range
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!m || (m[1] === '' && m[2] === '')) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`)
      return res.end()
    }
    if (m[1] === '') {
      const suffix = parseInt(m[2], 10)
      start = Math.max(0, total - suffix)
      end = total - 1
    } else {
      start = parseInt(m[1], 10)
      end = m[2] === '' ? total - 1 : parseInt(m[2], 10)
    }
    if (start > end || start >= total) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`)
      return res.end()
    }
    if (end >= total) end = total - 1
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
    res.setHeader('Content-Length', end - start + 1)
  } else {
    res.setHeader('Content-Length', total)
  }

  if (req.method === 'HEAD') return res.end()

  try {
    for await (const chunk of tarArchive.streamRange(job.index, start, end)) {
      if (chunk.length === 0) continue
      if (!res.write(chunk)) await new Promise((r) => res.once('drain', r))
    }
    res.end()
  } catch (e) {
    res.destroy()
  }
})

// Abandon a prepared job (releases the index)
app.delete('/__archive/:jobId', (req, res) => {
  archiveJobs.delete(req.params.jobId)
  res.json({ ok: true })
})

  app.delete('/__delete', express.json(), (req, res) => {
  if (currentMode !== 'write') return res.status(403).json({ error: 'Read only' })
  const itemPath = req.body.path
  if (!itemPath) return res.status(400).json({ error: 'No path' })
  try {
    const full = path.join(folderPath, itemPath)
    fs.rmSync(full, { recursive: true, force: true })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

  // file explorer
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();

    const reqPath = decodeURIComponent(req.path);
    const fullPath = path.join(folderPath, reqPath);

    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
       const rows = entries.map(e => {
  const isDir = e.isDirectory()
  const href = path.join(reqPath, e.name) + (isDir ? '/' : '')
  const itemPath = path.join(reqPath, e.name)
  const icon = isDir ? '📁' : '📄'
  let size = '—'
  let date = '—'
  try {
    const stat = fs.statSync(path.join(fullPath, e.name))
    date = stat.mtime.toLocaleDateString()
    if (!isDir) {
      const bytes = stat.size
      if (bytes < 1024) size = bytes + ' B'
      else if (bytes < 1024 * 1024) size = (bytes / 1024).toFixed(1) + ' KB'
      else if (bytes < 1024 * 1024 * 1024) size = (bytes / (1024 * 1024)).toFixed(1) + ' MB'
      else size = (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
    } else {
      size = formatSize(getFolderSize(path.join(fullPath, e.name)))
    }
  } catch {}
  return `<tr class="selectable" data-path="${itemPath}" data-href="${href}">
    <td class="icon">${icon}</td>
    <td><a href="${href}">${e.name}</a></td>
    <td class="size">${size}</td>
    <td class="date">${date}</td>
  </tr>`
}).join('')

        const parent =
          reqPath !== "/"
            ? '<tr><td>📁</td><td><a href="../">../</a></td></tr>'
            : "";

        const html = loadTemplate()
          .replace(/<PATH>/g, reqPath)
          .replace(/<PORT>/g, currentPort)
          .replaceAll(
            "<UPLOAD_DISPLAY>",
            currentMode === "write" ? "block" : "none",
          )
          .replace("<ROWS>", parent + rows);

        return res.send(html);
      }
    } catch {
      // no existe, pasa al siguiente
    }
    next();
  });

  // archivos estáticos
  app.use(express.static(folderPath));

  // watcher
  watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
    sseClients.forEach((client) => {
      client.write(
        `data: ${JSON.stringify({ event: eventType, file: filename })}\n\n`,
      );
    });
  });

  return new Promise((resolve, reject) => {
    let retried = false;
    let settled = false;

    const attempt = () => {
      // Use http.createServer directly: Express 5's app.listen() invokes the
      // callback itself on listen errors, which would resolve this promise
      // even when the port could not be bound.
      const srv = http.createServer(app);

      srv.on("error", (err) => {
        if (settled) {
          console.error("Server error:", err.message);
          return;
        }
        if (err.code === "EADDRINUSE" && !retried) {
          retried = true;
          setTimeout(attempt, 300);
          return;
        }
        serverInstance = null;
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        reject(err);
      });

      srv.listen(port, "0.0.0.0", () => {
        settled = true;
        serverInstance = srv;
        console.log(`Serving ${folderPath} on port ${port} — mode ${mode}`);
        resolve();
      });
    };

    attempt();
  });
}

function stop() {
  if (serverInstance) {
    serverInstance.close();
    if (typeof serverInstance.closeAllConnections === "function")
      serverInstance.closeAllConnections();
    serverInstance = null;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  sseClients = [];
  archiveJobs.clear();
  currentFolder = null;
}

module.exports = { start, stop, prepareArchive, deleteArchive, getPort: () => currentPort };
