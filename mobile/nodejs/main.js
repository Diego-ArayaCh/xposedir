'use strict'

// Android entry point for XposeDir.
//
// Runs inside the Node.js runtime embedded in the APK (nodejs-mobile). It is the
// counterpart of the Electron main process in ../main.js: same operations, same
// server, same discovery — but wired to Capacitor's `bridge` channel instead of
// ipcMain, and with the few platform shims Android needs.
//
// server.js / tar-archive.js / public-view.html are used unmodified.

const fs = require('fs')
const path = require('path')
const os = require('os')
const dgram = require('dgram')
const { Bonjour } = require('bonjour-service')

// ---------------------------------------------------------------------------
// Shim: fs.watch(root, { recursive: true }) is unsupported on Linux/Android and
// throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM. server.js calls it lazily (at
// start()), so patching the module here keeps server.js untouched.
// ---------------------------------------------------------------------------
const nativeWatch = fs.watch
fs.watch = function (target, options, listener) {
  if (!options || !options.recursive) return nativeWatch(target, options, listener)
  return require('./shims/poll-watch').startPollingWatch(target, listener)
}

const server = require('./server')

// The runtime is considered "ready" as soon as this module has been required.
let bridge = null
try {
  bridge = require('bridge')
} catch (e) {
  // Running outside the app (e.g. `node mobile/nodejs/main.js` for a smoke test).
  console.log('[xposedir] bridge module not available, running detached')
}

const bonjour = new Bonjour()
let bonjourService = null

const UDP_PORT = 5354
const UDP_BROADCAST_ADDR = '255.255.255.255'
let udpServer = null
let udpInterval = null

// ---------------------------------------------------------------------------
// Config: the Node project lives inside the APK assets, which are read-only and
// get overwritten on update — persistent state goes to the app's data dir.
// ---------------------------------------------------------------------------
const dataDir = (() => {
  if (bridge) {
    try {
      return bridge.app.datadir()
    } catch (e) {}
  }
  return path.join(os.tmpdir(), 'xposedir-android')
})()
const configPath = path.join(dataDir, 'config.json')

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (e) {
    return { ROUTE: '', PORT: 3000 }
  }
}

function writeConfig(config) {
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  } catch (e) {
    console.log('[xposedir] could not persist config: ' + e.message)
  }
}

// ---------------------------------------------------------------------------
// Bridge plumbing
// ---------------------------------------------------------------------------
function reply(id, err, value) {
  if (bridge) bridge.channel.post('xposedir:reply', id, err || null, value === undefined ? null : value)
}

function native(action, payload) {
  if (bridge) bridge.channel.post('xposedir:native', action, payload || null)
}

function handle(id, fn) {
  Promise.resolve()
    .then(fn)
    .then((value) => reply(id, null, value === undefined ? null : value))
    .catch((e) => reply(id, (e && e.message) || String(e), null))
}

if (bridge) {
  bridge.channel.on('choose-folder', (id) => {
    // The native folder picker lives in the WebView layer (it needs an Activity).
    native('choose-folder', null)
    reply(id, null, null)
  })

  bridge.channel.on('get-config', (id) => handle(id, () => readConfig()))

  bridge.channel.on('save-config', (id, config) =>
    handle(id, () => {
      writeConfig(config)
    })
  )

  bridge.channel.on('start-server', (id, folderPath, mode, port) =>
    handle(id, () => startServer(folderPath, mode, port))
  )

  bridge.channel.on('stop-server', (id) =>
    handle(id, () => {
      stopServer()
      native('foreground-stop', null)
    })
  )

  bridge.channel.on('discover', (id) => handle(id, () => discover()))

  bridge.channel.on('device-info', (id) => handle(id, () => ({ name: deviceName() })))
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
async function startServer(folderPath, mode, port) {
  if (!folderPath) throw new Error('No folder selected')

  let stat
  try {
    stat = fs.statSync(folderPath)
  } catch (e) {
    throw new Error('Folder is not accessible: ' + folderPath)
  }
  if (!stat.isDirectory()) throw new Error('Not a folder: ' + folderPath)

  await server.start(folderPath, { mode, port })

  if (bonjourService) bonjourService.stop()
  bonjourService = bonjour.publish({
    name: 'xposedir-' + deviceName(),
    type: 'xposedir',
    port: port,
    txt: { mode: mode }
  })

  startUdpBroadcast(port, mode)

  const ip = (await detectLanIP()) || 'localhost'
  const url = `http://${ip}:${port}`

  native('foreground-start', { url, port, mode, folder: folderPath })

  return { browser: url }
}

function stopServer() {
  server.stop()
  if (bonjourService) {
    bonjourService.stop()
    bonjourService = null
  }
  stopUdpBroadcast()
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
function deviceName() {
  try {
    const info = fs.readFileSync('/proc/sys/kernel/hostname', 'utf8').trim()
    if (info && info !== 'localhost') return info
  } catch (e) {}
  return 'android'
}

function startUdpBroadcast(port, mode) {
  if (udpServer) stopUdpBroadcast()
  try {
    udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  } catch (e) {
    udpServer = null
    return
  }
  udpServer.on('error', () => {})
  udpServer.bind(() => {
    try {
      udpServer.setBroadcast(true)
    } catch (e) {}
    const msg = JSON.stringify({ type: 'xposedir', name: deviceName(), port, mode })
    udpInterval = setInterval(() => {
      try {
        udpServer.send(msg, UDP_PORT, UDP_BROADCAST_ADDR)
      } catch (e) {}
    }, 2000)
    try {
      udpServer.send(msg, UDP_PORT, UDP_BROADCAST_ADDR)
    } catch (e) {}
  })
}

function stopUdpBroadcast() {
  if (udpInterval) {
    clearInterval(udpInterval)
    udpInterval = null
  }
  if (udpServer) {
    try {
      udpServer.close()
    } catch (e) {}
    udpServer = null
  }
}

function isPrivateIPv4(ip) {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  )
}

function detectLanIP() {
  return new Promise((resolve) => {
    let done = false
    const finish = (ip) => {
      if (!done) {
        done = true
        resolve(ip)
      }
    }

    const socket = dgram.createSocket('udp4')
    socket.once('error', () => {
      try {
        socket.close()
      } catch (e) {}
      finish(null)
    })
    try {
      socket.connect(80, '8.8.8.8', () => {
        let addr = null
        try {
          addr = socket.address().address
        } catch (e) {}
        try {
          socket.close()
        } catch (e) {}
        finish(isPrivateIPv4(addr) ? addr : null)
      })
    } catch (e) {
      try {
        socket.close()
      } catch (e2) {}
      finish(null)
    }
  }).then((ip) => {
    if (ip) return ip
    const all = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
      .map((i) => i.address)
    return all.find(isPrivateIPv4) || all[0] || null
  })
}

function discoverUdp() {
  return new Promise((resolve) => {
    const found = []
    let client
    try {
      client = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    } catch (e) {
      return resolve(found)
    }
    client.on('error', () => {})
    client.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString())
        if (data.type === 'xposedir' && data.port && data.mode) {
          if (!found.find((s) => s.host === rinfo.address && s.port === data.port)) {
            found.push({
              name: data.name,
              host: rinfo.address,
              port: data.port,
              mode: data.mode,
              url: `http://${rinfo.address}:${data.port}`
            })
          }
        }
      } catch (e) {}
    })
    client.bind(UDP_PORT, () => {
      try {
        client.setBroadcast(true)
        client.send(JSON.stringify({ type: 'xposedir-query' }), UDP_PORT, UDP_BROADCAST_ADDR)
      } catch (e) {}
    })
    setTimeout(() => {
      try {
        client.close()
      } catch (e) {}
      resolve(found)
    }, 3000)
  })
}

async function discover() {
  const found = []

  const bonjourFound = await new Promise((resolve) => {
    let browser
    try {
      browser = bonjour.find({ type: 'xposedir' })
    } catch (e) {
      return resolve([])
    }
    const results = []
    browser.on('up', (service) => {
      results.push({
        name: service.name,
        host: service.host,
        port: service.port,
        mode: (service.txt && service.txt.mode) || 'read',
        url: `http://${service.referer.address}:${service.port}`
      })
    })
    setTimeout(() => {
      try {
        browser.stop()
      } catch (e) {}
      resolve(results)
    }, 1500)
  })

  found.push(...bonjourFound)
  if (found.length === 0) found.push(...(await discoverUdp()))
  return found
}

if (bridge && bridge.app && typeof bridge.app.on === 'function') {
  bridge.app.on('resume', () => native('resumed', null))
}

module.exports = { startServer, stopServer, discover, readConfig, writeConfig, dataDir }