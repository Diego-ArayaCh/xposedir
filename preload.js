const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  startServer: (folder, mode, port) => ipcRenderer.invoke('start-server', folder, mode, port),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  discover: () => ipcRenderer.invoke('discover'),
  getTheme: () => ipcRenderer.invoke('get-theme')
})