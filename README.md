# XposeDir

Simple local file sharing server with zero configuration. Share files across devices on your local network instantly.

## Features

- **Zero Configuration** - Just select a folder and click Start
- **Auto Discovery** - Other devices find your server automatically via mDNS (Bonjour) and UDP broadcast
- **Cross Platform** - Works on Linux, Windows, macOS **and Android**
- **Android** - Native APK that runs the same Node.js server on the device
- **Two Access Modes**
  - Read-only: Others can view and download files
  - Read & Write: Others can also upload, edit, and delete files
- **Dark/Light Theme** - Toggle between themes seamlessly
- **Network Discovery** - Scan your local network for other XposeDir instances

## Installation

### From Release

Download the latest release for your platform from the [releases page](https://github.com/Diego-ArayaCh/XposeDir/releases).

### Build from Source

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build for Linux
npm run build:linux

# Build for Windows
npm run build:win
```

## Android

The Android app is a Capacitor shell that embeds a Node.js runtime, so it runs the
**same `server.js` / `tar-archive.js` / `public-view.html`** as the desktop build.
Nothing in the desktop UI is modified: `scripts/build-android.mjs` assembles `www/`
and injects the bridge into the copy of `index.html`.

### Requirements

- JDK 21 (`JAVA_HOME`)
- Android SDK with `platform-tools`, `platforms/android-36`, `build-tools/36.0.0`,
  `ndk/27.0.12077973` and `cmake/3.22.1` (`ANDROID_HOME`)

### Build

```bash
npm run android:apk          # -> android/app/build/outputs/apk/debug/app-debug.apk
npm run android:apk:emulator # same, plus x86_64 for the emulator
npm run android:run          # build + install + launch on a connected device
npm run android:test         # exercise every server endpoint, no device needed
npm run android:release      # unsigned unless XPOSEDIR_KEYSTORE is set
```

The APK is ~93 MB: the embedded Node.js runtime is ~83 MB on its own, so only
`arm64-v8a` is packaged by default.

### First run

Android asks for **"All files access"** the first time you tap *Change*. It is
special app access, so there is no system dialog: the app explains why it needs it
and opens *Settings → Special app access → All files access*. Only internal-storage
folders can be shared, because the Node runtime needs a real filesystem path.

While the server runs, a foreground-service notification keeps it alive in the
background; use *Detener* in the notification to stop it.

### Layout

| Path | What it is |
| --- | --- |
| `capacitor.config.json` | Capacitor + Nodejs plugin configuration |
| `scripts/build-android.mjs` | Assembles `www/` from the existing sources |
| `scripts/smoke-server.mjs` | Runs the shipped Node project and tests every endpoint |
| `mobile/api-bridge.js` | `window.api` on top of the Capacitor Node bridge |
| `mobile/nodejs/main.js` | Android counterpart of `main.js` (uses `bridge`, not `ipcMain`) |
| `mobile/nodejs/shims/poll-watch.js` | Polling replacement for recursive `fs.watch` (unsupported on Android) |
| `android/app/src/main/java/…` | Folder picker (SAF → real path), foreground service, multicast lock |

`index.html`, `styles/`, `server.js`, `tar-archive.js`, `public-view.html`,
`main.js` and `preload.js` are **shared with the desktop build and untouched**.

## Usage

1. Launch XposeDir
2. Click "Change" to select the folder you want to share
3. Choose access permissions (Read only or Read & Write)
4. Optionally change the port (default: 3000)
5. Click "Start server"
6. Other devices on your network will automatically discover your server

### Opening to Other Devices

- Click "Open" to open in your default browser
- Click "Show IP" to see the local IP address
- Click "Copy" to copy the URL to clipboard
- Other devices can use the Discover tab to find your server

## Tech Stack

- Electron
- Express.js
- mDNS/Bonjour
- Vanilla JavaScript (no framework)

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING](CONTRIBUTING.md) guidelines before submitting PRs.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) to keep our community approachable and respectful.