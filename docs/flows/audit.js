const { app, BrowserWindow } = require('electron')
const path = require('path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 1300, webPreferences: { offscreen: true } })
  await win.loadFile(path.join(__dirname, 'app-flows.html'))

  const report = await win.webContents.executeJavaScript(`(() => {
    const issues = []
    const svgs = [...document.querySelectorAll('svg.flow')]

    svgs.forEach((svg, si) => {
      const name = si === 0 ? 'CLIENT' : 'HOST'
      const vb = svg.viewBox.baseVal

      // --- text overflow vs its group rect ---
      svg.querySelectorAll('g').forEach((g) => {
        const rect = g.querySelector('rect')
        if (!rect) return
        const texts = [...g.querySelectorAll(':scope > text')]
        if (!texts.length) return
        const rb = rect.getBBox()
        texts.forEach((t) => {
          const tb = t.getBBox()
          const pad = 2
          if (tb.x < rb.x - pad || tb.x + tb.width > rb.x + rb.width + pad) {
            issues.push(name + ': text overflows width: "' + t.textContent.trim().slice(0, 36) + '" ')
          }
          // bottom check: last baseline within rect (tspan height ~1.2*size)
          if (tb.y + tb.height > rb.y + rb.height + 6) {
            issues.push(name + ': text overflows bottom: "' + t.textContent.trim().slice(0, 36) + '" y-top=' + Math.round(tb.y) + ' rect-bottom=' + Math.round(rb.y + rb.height))
          }
        })
      })

      // --- solid box collisions ---
      const solid = [...svg.querySelectorAll('[class*="box"], [class*="dec"]')].map((r) => {
        const b = r.getBBox()
        return { r, x: b.x, y: b.y, w: b.width, h: b.height, cls: r.getAttribute('class') }
      })
      for (let i = 0; i < solid.length; i++) {
        for (let j = i + 1; j < solid.length; j++) {
          const a = solid[i], b = solid[j]
          const ox = Math.min(a.x + a.w - b.x, b.x + b.w - a.x)
          const oy = Math.min(a.y + a.h - b.y, b.y + b.h - a.y)
          if (ox > 2 && oy > 2) {
            issues.push(name + ': boxes overlap by ' + Math.round(ox) + 'x' + Math.round(oy) + ' (' + a.cls + ' vs ' + b.cls + ')')
          }
        }
      }

      // --- content out of viewBox ---
      svg.querySelectorAll('rect, text').forEach((el) => {
        const b = el.getBBox()
        const cls = el.getAttribute('class') || el.tagName
        if (!['navbox', 'srvbox', 'decbox', 'terbox', 'errbox', 'minibox', 'lanehead'].some((c) => cls.includes(c))) return
        if (b.x < 0 || b.y < 0 || b.x + b.width > vb.width + 2 || b.y + b.height > vb.height + 2) {
          issues.push(name + ': out of canvas ' + cls + ' at ' + Math.round(b.x) + ',' + Math.round(b.y) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height))
        }
      })

      issues.push(name + ': OK scan (viewBox ' + Math.round(vb.width) + 'x' + Math.round(vb.height) + ', boxes=' + solid.length + ')')
    })
    return issues
  })()`)

  console.log(report.join('\n'))
  app.exit(0)
}).catch((e) => { console.error('FAIL:', e.message); app.exit(1) })