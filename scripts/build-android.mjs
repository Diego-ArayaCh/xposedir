// Assembles www/ — the webDir Capacitor ships inside the APK.
//
// Nothing in the repository's own UI is edited: index.html is copied verbatim and
// the bridge <script> is injected into the copy, styles/ is copied as-is, and the
// Node project reuses the very same server.js / tar-archive.js / public-view.html
// that the desktop build uses.
//
//   node scripts/build-android.mjs [--skip-install]

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const www = path.join(root, 'www')
const nodeDir = path.join(www, 'nodejs')
const skipInstall = process.argv.includes('--skip-install')

const BRIDGE_TAG = '    <script src="api-bridge.js"></script>\n'

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(src, dst)
    else if (entry.isFile()) fs.copyFileSync(src, dst)
  }
}

function buildUi() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  if (!html.includes('</head>')) throw new Error('index.html has no </head>')
  if (html.includes('api-bridge.js')) {
    console.log('· index.html already references api-bridge.js, copying as-is')
    fs.writeFileSync(path.join(www, 'index.html'), html)
  } else {
    const injected = html.replace('</head>', BRIDGE_TAG + '  </head>')
    fs.writeFileSync(path.join(www, 'index.html'), injected)
    console.log('· index.html -> www/index.html (bridge script injected)')
  }
  copyDir(path.join(root, 'styles'), path.join(www, 'styles'))
  copy(path.join(root, 'mobile', 'api-bridge.js'), path.join(www, 'api-bridge.js'))
  console.log('· styles/ + api-bridge.js copied')
}

function buildNodeProject() {
  fs.mkdirSync(path.join(nodeDir, 'shims'), { recursive: true })

  // Shared with the desktop build — copied, never modified.
  for (const file of ['server.js', 'tar-archive.js', 'public-view.html']) {
    copy(path.join(root, file), path.join(nodeDir, file))
  }
  // Android-only entry point + shims.
  for (const file of ['main.js', 'package.json']) {
    copy(path.join(root, 'mobile', 'nodejs', file), path.join(nodeDir, file))
  }
  copyDir(path.join(root, 'mobile', 'nodejs', 'shims'), path.join(nodeDir, 'shims'))
  console.log('· www/nodejs: server.js, tar-archive.js, public-view.html, main.js, shims/')
}

function installNodeDeps() {
  if (skipInstall) {
    console.log('· skipping npm install (--skip-install)')
    return
  }
  const pkgPath = path.join(nodeDir, 'package.json')
  const hash = createHash('sha1').update(fs.readFileSync(pkgPath)).digest('hex')
  const stampFile = path.join(nodeDir, '.deps-hash')
  const current = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8') : ''

  if (current === hash && fs.existsSync(path.join(nodeDir, 'node_modules'))) {
    console.log('· www/nodejs/node_modules already up to date')
    return
  }

  console.log('· installing Node dependencies into www/nodejs (express, archiver, multer, bonjour-service)…')
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: nodeDir,
    stdio: 'inherit',
    shell: true
  })
  fs.writeFileSync(stampFile, hash)
}

function main() {
  fs.mkdirSync(www, { recursive: true })
  buildUi()
  buildNodeProject()
  installNodeDeps()

  const size = dirSize(nodeDir)
  console.log(`\nwww/ ready — Node project is ${(size / 1024 / 1024).toFixed(1)} MB`)
  console.log('Next: npx cap sync android')
}

function dirSize(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size
  }
  return total
}

main()