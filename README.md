# XposeDir

Simple local file sharing server with zero configuration. Share files across devices on your local network instantly.

## Features

- **Zero Configuration** - Just select a folder and click Start
- **Auto Discovery** - Other devices find your server automatically via mDNS (Bonjour) and UDP broadcast
- **Cross Platform** - Works on Linux, Windows, and macOS
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