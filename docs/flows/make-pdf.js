const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

async function snap(win, file, scrollY) {
  await win.webContents.executeJavaScript(`window.scrollTo(0, ${scrollY})`)
  await new Promise((r) => setTimeout(r, 350))
  const img = await win.webContents.capturePage()
  const buf = img.toPNG()
  if (!buf || buf.length === 0) throw new Error('empty capture: ' + file)
  fs.writeFileSync(path.join(__dirname, file), buf)
  console.log('PNG OK:', file, buf.length + ' bytes')
}

async function main() {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1300,
    webPreferences: { offscreen: true }
  })
  await win.loadFile(path.join(__dirname, 'app-flows.html'))

  // screen mode -> px sizing, prime painting, then snap each sheet
  await win.webContents.executeJavaScript("document.body.setAttribute('data-mode','screen')")
  await win.webContents.capturePage()

  await snap(win, 'page1-client.png', 0)
  await snap(win, 'page2-host.png', 1300)

  // print mode -> mm sizing for the PDF
  await win.webContents.executeJavaScript("document.body.removeAttribute('data-mode')")
  await new Promise((r) => setTimeout(r, 250))
  const pdf = await win.webContents.printToPDF({
    landscape: true,
    printBackground: true,
    pageSize: 'A4',
    margins: { marginType: 'none' }
  })
  const out = path.join(__dirname, 'flujos-app.pdf')
  fs.writeFileSync(out, pdf)
  console.log('PDF OK:', out, pdf.length + ' bytes')
  app.exit(0)
}

app.whenReady().then(main).catch((e) => {
  console.error('FAIL:', e.message)
  app.exit(1)
})