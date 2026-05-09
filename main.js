const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { Bonjour } = require('bonjour-service')
const bonjour = new Bonjour()
let bonjourService = null
const configPath = path.join(__dirname, 'config.json')

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
  const win = new BrowserWindow({
    width: 600,
    height: 710,
     icon: path.join(__dirname, 'build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })
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


ipcMain.handle('start-server', (_, folderPath, mode, port) => {
  server.start(folderPath, { mode, port })

  // alert bonjour to make this instance discoverable on the network
  if (bonjourService) bonjourService.stop()
  bonjourService = bonjour.publish({
    name: 'xposedir-' + os.hostname(),
    type: 'xposedir',
    port: port,
    txt: { mode: mode }
  })

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
})

// discovery — search for other instances of xposedir on the local network and return their info (name, host, port, mode, url)
ipcMain.handle('discover', () => {
  return new Promise((resolve) => {
    const found = []
    const browser = bonjour.find({ type: 'xposedir' })

    browser.on('up', (service) => {
      found.push({
        name: service.name,
        host: service.host,
        port: service.port,
        mode: service.txt?.mode || 'read',
        url: `http://${service.referer.address}:${service.port}`
      })
    })

    // give it a few seconds to discover services, then stop and return what we found
    setTimeout(() => {
      browser.stop()
      resolve(found)
    }, 3000)
  })
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

app.whenReady().then(createWindow)