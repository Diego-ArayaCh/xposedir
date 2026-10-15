// Smoke test: runs the Node project exactly as it is shipped inside the APK
// (www/nodejs/main.js + the unmodified server.js / tar-archive.js) and exercises
// every endpoint, so the server can be verified without a device.
//
//   node scripts/build-android.mjs && node scripts/smoke-server.mjs

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nodeDir = path.join(root, 'www', 'nodejs')
const PORT = 3999
const BASE = `http://127.0.0.1:${PORT}`

if (!fs.existsSync(path.join(nodeDir, 'main.js'))) {
  console.error('www/nodejs not built — run: node scripts/build-android.mjs')
  process.exit(1)
}

const share = fs.mkdtempSync(path.join(os.tmpdir(), 'xposedir-share-'))
fs.writeFileSync(path.join(share, 'hola.txt'), 'hola mundo\n')
fs.mkdirSync(path.join(share, 'carpeta'))
fs.writeFileSync(path.join(share, 'carpeta', 'a.txt'), 'a'.repeat(2048))
fs.writeFileSync(path.join(share, 'carpeta', 'b.txt'), 'b'.repeat(2048))

let failures = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
  if (!ok) failures++
}

const require = createRequire(import.meta.url)
const app = require(path.join(nodeDir, 'main.js'))
const url = await app.startServer(share, 'write', PORT)
check('server starts', url.browser.includes(String(PORT)), url.browser)

// 1. directory listing
const listing = await fetch(BASE + '/')
const listingHtml = await listing.text()
check('GET / renders index', listing.ok && listingHtml.includes('hola.txt'))
check('GET / shows upload controls in write mode', listingHtml.includes('display: block'))

// 2. static file
const file = await fetch(BASE + '/hola.txt')
check('GET /hola.txt', file.ok && (await file.text()).trim() === 'hola mundo')

// 3. single download endpoint
const dl = await fetch(`${BASE}/__download?items=${encodeURIComponent('hola.txt')}`)
check('GET /__download single', dl.ok && (await dl.text()).trim() === 'hola mundo')

// 4. zip of a folder
const zip = await fetch(`${BASE}/__download`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: ['carpeta'] })
})
const zipBuf = Buffer.from(await zip.arrayBuffer())
check('POST /__download folder → zip', zip.ok && zipBuf.subarray(0, 2).toString() === 'PK', `${zipBuf.length} bytes`)

// 5. virtual TAR + Range
const prep = await fetch(BASE + '/__prepare', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: ['carpeta'] })
})
const job = await prep.json()
check('POST /__prepare', prep.ok && !!job.jobId, `${job.files} files, ${job.folders} folders, ${job.totalBytes} bytes`)

const ranged = await fetch(`${BASE}/__archive/${job.jobId}`, { headers: { Range: 'bytes=0-1023' } })
const rangedBuf = Buffer.from(await ranged.arrayBuffer())
check('GET /__archive/:id with Range → 206', ranged.status === 206 && rangedBuf.length === 1024)
check('  tar header is a valid ustar block', rangedBuf.subarray(257, 262).toString() === 'ustar')

const fullTar = await fetch(`${BASE}/__archive/${job.jobId}`)
const tarBuf = Buffer.from(await fullTar.arrayBuffer())
check('GET /__archive/:id full stream', fullTar.ok && tarBuf.length === job.totalBytes, `${tarBuf.length} bytes`)
check('  ends with two zero blocks', tarBuf.subarray(tarBuf.length - 1024).every((b) => b === 0))

// 6. SSE — the body only produces bytes once something changes on disk, so the
// trigger has to be written before (and while) we read the stream.
const sse = await fetch(BASE + '/__events')
const reader = sse.body.getReader()
await new Promise((r) => setTimeout(r, 200))
fs.writeFileSync(path.join(share, 'sse.txt'), 'trigger')
const sseChunk = await Promise.race([
  reader.read(),
  new Promise((r) => setTimeout(() => r({ value: Buffer.from('timeout') }), 8000))
])
const sseText = Buffer.from(sseChunk.value || '').toString()
check('GET /__events emits a change event', sseText.includes('data:'), sseText.trim().slice(0, 80))
await reader.cancel().catch(() => {})

// 7. write operations
const upload = await fetch(`${BASE}/__upload?path=${encodeURIComponent('/')}`, {
  method: 'POST',
  body: (() => {
    const form = new FormData()
    form.append('files', new Blob(['subido\n'], { type: 'text/plain' }), 'subido.txt')
    return form
  })()
})
check('POST /__upload multipart', upload.ok && fs.existsSync(path.join(share, 'subido.txt')))

const mkdir = await fetch(BASE + '/__mkdir', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: '/', name: 'nueva' })
})
check('POST /__mkdir', mkdir.ok && fs.existsSync(path.join(share, 'nueva')))

const del = await fetch(BASE + '/__delete', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: 'nueva' })
})
check('DELETE /__delete', del.ok && !fs.existsSync(path.join(share, 'nueva')))

// 8. path traversal is refused
const escape = await fetch(`${BASE}/__download?items=${encodeURIComponent('../../etc/passwd')}`)
check('path traversal blocked', escape.status === 400, `status ${escape.status}`)

app.stopServer()
fs.rmSync(share, { recursive: true, force: true })

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)