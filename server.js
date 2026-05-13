const express = require("express");
  const archiver = require('archiver')
// const { v2: webdav } = require('webdav-server')
const fs = require("fs");
const path = require("path");

let serverInstance = null;
let watcher = null;
let sseClients = [];
let currentPort = 3000;
let templateHtml = null;
let currentMode = "read";

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

function start(folderPath, { mode = "read", port = 3000 } = {}) {
  currentPort = port;
  currentMode = mode;
  if (serverInstance) serverInstance.close();
  if (watcher) watcher.close();
  sseClients = [];
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




app.post('/__download', express.json(), (req, res) => {
  const items = req.body.items  // array de rutas relativas
  if (!items || !items.length) return res.status(400).json({ error: 'No items' })

  // si es un solo archivo, descargalo directo
  if (items.length === 1) {
    const fullPath = path.join(folderPath, items[0])
    const stat = fs.statSync(fullPath)
    if (stat.isFile()) {
      return res.download(fullPath)
    }
  }

  // múltiples archivos o carpeta — zip
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="xposedir-download.zip"')

  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.pipe(res)

  items.forEach(item => {
    const fullPath = path.join(folderPath, item)
    try {
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        archive.directory(fullPath, path.basename(item))
      } else {
        archive.file(fullPath, { name: path.basename(item) })
      }
    } catch {}
  })

  archive.finalize()
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

  serverInstance = app.listen(port, "0.0.0.0", () => {
    console.log(`Serving ${folderPath} on port ${port} — mode ${mode}`);
  });
}

function stop() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  sseClients = [];
}

module.exports = { start, stop };
