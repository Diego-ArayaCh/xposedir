/*
 * window.api — Capacitor implementation of the bridge Electron's preload.js exposes.
 *
 * index.html is shared between desktop and Android untouched: the build script only
 * injects <script src="api-bridge.js"></script> into the copy it ships.
 *
 * Transport: request/response over the Node.js runtime channel.
 *   Web  -> Node : Nodejs.send({ eventName, args: [id, ...args] })
 *   Node -> Web  : channel.post('xposedir:reply', id, err, value)
 *                   channel.post('xposedir:native', action, payload)  -> native plugin
 */
;(function () {
  var REPLY = 'xposedir:reply'
  var NATIVE = 'xposedir:native'
  var READY_TIMEOUT = 30000

  var pending = new Map()
  var seq = 0
  var started = null

  function plugin(name) {
    var plugins = (window.Capacitor && window.Capacitor.Plugins) || {}
    return plugins[name] || null
  }

  function callPlugin(name, method, args) {
    var p = plugin(name)
    if (!p || typeof p[method] !== 'function') {
      return Promise.reject(new Error('Native plugin not available: ' + name + '.' + method))
    }
    return p[method](args || {})
  }

  function waitForCapacitor() {
    if (window.Capacitor) return Promise.resolve(window.Capacitor)
    return new Promise(function (resolve, reject) {
      var elapsed = 0
      var timer = setInterval(function () {
        elapsed += 50
        if (window.Capacitor) {
          clearInterval(timer)
          resolve(window.Capacitor)
        } else if (elapsed > READY_TIMEOUT) {
          clearInterval(timer)
          reject(new Error('Capacitor bridge did not load'))
        }
      }, 50)
    })
  }

  function handleMessage(event) {
    var args = event.args || []

    if (event.eventName === REPLY) {
      var id = args[0]
      var err = args[1]
      var value = args[2]
      var entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      if (err) entry.reject(err instanceof Error ? err : new Error(String(err)))
      else entry.resolve(value)
      return
    }

    if (event.eventName === NATIVE) {
      runNative(args[0], args[1] || {})
    }
  }

  // Requests coming from Node that need an Activity / System service.
  function runNative(action, payload) {
    switch (action) {
      case 'choose-folder':
        callPlugin('FolderPicker', 'choose', {}).catch(function () {})
        break
      case 'foreground-start':
        callPlugin('NativeHost', 'startForeground', payload).catch(function () {})
        break
      case 'foreground-stop':
        callPlugin('NativeHost', 'stopForeground', {}).catch(function () {})
        break
      case 'resumed':
        callPlugin('NativeHost', 'onResumed', {}).catch(function () {})
        break
      default:
        break
    }
  }

  // Registers the message listener exactly once. Every call() awaits this before
  // sending, otherwise the very first reply (get-config, fired as soon as
  // index.html is parsed) could arrive before the listener exists and be dropped.
  function start() {
    return waitForCapacitor()
      .then(function () {
        var nodejs = plugin('Nodejs')
        if (!nodejs) throw new Error('Capacitor Nodejs plugin not installed')
        return nodejs.addListener('message', handleMessage).then(function () {
          return waitForNode(nodejs)
        })
      })
      .catch(function (e) {
        console.error('[xposedir]', e && e.message ? e.message : e)
      })
  }

  function ready() {
    if (!started) started = start()
    return started
  }

  function waitForNode(nodejs) {
    return new Promise(function (resolve) {
      var done = false
      function ready() {
        if (done) return
        done = true
        resolve()
      }
      nodejs.isReady().then(function (r) {
        if (r && r.ready) ready()
      }).catch(ready)
      nodejs.addListener('ready', ready).catch(ready)
      setTimeout(ready, READY_TIMEOUT)
    })
  }

  function call(eventName) {
    var args = Array.prototype.slice.call(arguments, 1)
    return ready().then(function () {
      var nodejs = plugin('Nodejs')
      if (!nodejs) throw new Error('Capacitor Nodejs plugin not installed')
      return new Promise(function (resolve, reject) {
        var id = ++seq
        pending.set(id, { resolve: resolve, reject: reject })
        nodejs
          .send({ eventName: eventName, args: [id].concat(args) })
          .catch(function (e) {
            pending.delete(id)
            reject(e instanceof Error ? e : new Error(String(e && e.message ? e.message : e)))
          })
      })
    })
  }

  window.api = {
    chooseFolder: function () {
      // Handled natively: it needs an Activity to show the SAF picker.
      return callPlugin('FolderPicker', 'choose', {}).then(function (r) {
        return r && r.path ? r.path : null
      })
    },
    startServer: function (folder, mode, port) {
      return call('start-server', folder, mode, port)
    },
    stopServer: function () {
      return call('stop-server')
    },
    getConfig: function () {
      return call('get-config')
    },
    saveConfig: function (config) {
      return call('save-config', config)
    },
    openExternal: function (url) {
      var app = plugin('App')
      if (app && app.openUrl) return app.openUrl({ url: url })
      window.open(url, '_system')
      return Promise.resolve()
    },
    discover: function () {
      // mDNS needs the Wi-Fi multicast lock, otherwise the driver drops packets.
      return callPlugin('NativeHost', 'acquireMulticastLock', {})
        .catch(function () {})
        .then(function () {
          return call('discover')
        })
    },
    getTheme: function () {
      return Promise.resolve(
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
      )
    }
  }

  // Kick off early: index.html calls getConfig() as soon as it is parsed.
  start()
})()