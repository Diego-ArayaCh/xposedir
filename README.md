# XposeDir

> Simple, fast local network file sharing — built with Electron and Express.

XposeDir lets you expose any folder on your machine to your local network in seconds. No configuration, no accounts, no cloud. Just pick a folder, choose the access mode, and share.

---

## Features

- **One-click sharing** — select a folder and start the server instantly
- **Read only or read & write** — you decide what others can do
- **Live browser index** — anyone on your network can browse and download files from their browser
- **Auto-reload** — the browser index updates automatically when files change, no manual refresh needed
- **Drag & drop upload** — in read & write mode, others can upload files directly from the browser
- **Create folders** — create new directories remotely from the browser
- **Network discovery** — find other XposeDir instances running on your local network
- **Dark mode** — follows your system preference
- **Cross-platform** — runs on Linux and Windows

---

## How it works

```
Your machine                        Other devices on LAN
┌─────────────────────┐             ┌──────────────────┐
│  XposeDir (Electron)│             │  Any browser     │
│                     │  HTTP       │                  │
│  Express server ────┼────────────►│  Browse & dl     │
│  fs.watch + SSE  ◄──┼────────────►│  Upload files    │
│                     │             └──────────────────┘
│  Bonjour/mDNS    ───┼──► announces to LAN
└─────────────────────┘
```

XposeDir runs an Express server that serves your chosen folder over HTTP. A file watcher detects changes and notifies connected browsers via Server-Sent Events, so the file index stays live. The app announces itself on the network using mDNS (Bonjour), so other XposeDir instances can discover each other automatically.

---

## Getting started

### Requirements

- Node.js 18+
- npm

### Install and run

```bash
git clone https://github.com/Diego-ArayaCh/xposedir.git
cd xposedir
npm install
npm start
```

### Build

```bash
# Linux (.deb + AppImage)
npm run build:linux

# Windows (.exe installer)
npm run build:win
```

Builds are output to the `dist/` folder.

---

## Usage

1. Open XposeDir
2. Click **Change** to select the folder you want to share
3. Choose **Read only** or **Read & write**
4. Set the port (default: 3000)
5. Click **Start server**
6. Share the URL shown with anyone on your network

In **Read only** mode, others can browse and download files.  
In **Read & write** mode, others can also upload files and create folders.

To find other XposeDir instances on your network, go to the **Discover** tab and hit **Scan**.

---

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| Server | Express |
| File uploads | Multer |
| Live reload | fs.watch + Server-Sent Events |
| Network discovery | Bonjour (mDNS) |

---

## License

MIT
