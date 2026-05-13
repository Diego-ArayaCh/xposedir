const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron')
const path = require('path')
const fs = require('fs')
const dgram = require('dgram')
const { spawn } = require('child_process')
const { Bonjour } = require('bonjour-service')
const bonjour = new Bonjour()
let bonjourService = null
const configPath = path.join(__dirname, 'config.json')

const UDP_PORT = 5354
const UDP_BROADCAST_ADDR = '255.255.255.255'
let udpServer = null
let udpInterval = null

function readConfig() {
  try {
    const data = fs.readFileSync(configPath, 'utf8')
    return JSON.parse(data)
  } catch (e) {
    return { ROUTE: '', PORT: 3000 }
  }
}

function writeConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

function createWindow() {
  const isPackaged = app.isPackaged
  const iconPath = isPackaged 
    ? path.join(process.resourcesPath, 'app', 'build', 'icon.png')
    : path.join(__dirname, 'build', 'icon.png')

  const win = new BrowserWindow({
    width: 600,
    height: 710,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })
  if (process.platform === 'linux' && fs.existsSync(iconPath)) {
    win.setIcon(iconPath)
  }
  win.loadFile('index.html')
  win.removeMenu(false)
  // win.webContents.openDevTools()
}
//workaround for xdg-desktop-portal hanging on Linux after folder selection
function cleanupPortal() {
  if (process.platform !== 'linux') return  // ←  Windows/Mac don't have this issue
  try {
    spawn('pkill', ['-9', '-f', 'xdg-desktop-portal'], { detached: true, stdio: 'ignore' })
  } catch (e) {}
}
// on Linux, xdg-desktop-portal sometimes hangs after a folder selection, preventing future dialogs from opening. This is a workaround to kill it before showing the dialog again.
ipcMain.handle('choose-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  cleanupPortal()
  await new Promise(r => setTimeout(r, 300))
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

const server = require('./server')
const os = require('os')


function startUdpBroadcast(port, mode) {
  if (udpServer) stopUdpBroadcast()
  
  udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  
  udpServer.bind(() => {
    udpServer.setBroadcast(true)
    const hostname = os.hostname()
    const msg = JSON.stringify({ type: 'xposedir', name: hostname, port, mode })
    
    udpInterval = setInterval(() => {
      udpServer.send(msg, UDP_PORT, UDP_BROADCAST_ADDR)
    }, 2000)
    
    udpServer.send(msg, UDP_PORT, UDP_BROADCAST_ADDR)
  })
}

function stopUdpBroadcast() {
  if (udpInterval) {
    clearInterval(udpInterval)
    udpInterval = null
  }
  if (udpServer) {
    udpServer.close()
    udpServer = null
  }
}

ipcMain.handle('start-server', (_, folderPath, mode, port) => {
  server.start(folderPath, { mode, port })

  if (bonjourService) bonjourService.stop()
  bonjourService = bonjour.publish({
    name: 'xposedir-' + os.hostname(),
    type: 'xposedir',
    port: port,
    txt: { mode: mode }
  })

  startUdpBroadcast(port, mode)

  const ip = Object.values(os.networkInterfaces())
    .flat()
    .find(i => i.family === 'IPv4' && !i.internal)?.address

  return {
    browser: `http://${ip}:${port}`
  }
})

ipcMain.handle('stop-server', () => {
  server.stop()
  if (bonjourService) {
    bonjourService.stop()
    bonjourService = null
  }
  stopUdpBroadcast()
})

function discoverUdp() {
  return new Promise((resolve) => {
    const found = []
    const client = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    
    client.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString())
        if (data.type === 'xposedir' && data.port && data.mode) {
          if (!found.find(s => s.host === rinfo.address && s.port === data.port)) {
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
      client.setBroadcast(true)
      client.send(JSON.stringify({ type: 'xposedir-query' }), UDP_PORT, UDP_BROADCAST_ADDR)
    })
    
    setTimeout(() => {
      client.close()
      resolve(found)
    }, 3000)
  })
}

ipcMain.handle('discover', async () => {
  const found = []
  
  const bonjourFound = await new Promise((resolve) => {
    const browser = bonjour.find({ type: 'xposedir' })
    const results = []
    
    browser.on('up', (service) => {
      results.push({
        name: service.name,
        host: service.host,
        port: service.port,
        mode: service.txt?.mode || 'read',
        url: `http://${service.referer.address}:${service.port}`
      })
    })
    
    setTimeout(() => {
      browser.stop()
      resolve(results)
    }, 1500)
  })
  
  found.push(...bonjourFound)
  
  if (found.length === 0) {
    const udpFound = await discoverUdp()
    found.push(...udpFound)
  }
  
  return found
})

// ipcMain.handle('stop-server', () => {
//   server.stop()
// })

ipcMain.handle('get-config', () => {
  return readConfig()
})

ipcMain.handle('save-config', (_, config) => {
  writeConfig(config)
})

ipcMain.handle('open-external', (_, url) => {
  shell.openExternal(url)
})

ipcMain.handle('get-theme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

app.whenReady().then(createWindow)