# Infisical AI - VS Code Extension

A production-ready VS Code extension for AI-powered Infisical secrets management.

## Features

- 🔐 **Universal Auth Login** - Secure authentication with Infisical using clientId/clientSecret
- 📁 **Project & Environment Selection** - Browse and manage multiple projects and environments
- 🔑 **Secrets Management** - Create, read, update, and delete secrets with full CRUD operations
- 🤖 **AI-Powered Features** - Smart explanations, auto-fix missing secrets, intelligent diffs
- 🌐 **Control Panel** - React-based webview for comprehensive secrets management
- 📊 **Activity Bar Integration** - Dedicated secrets tree view in VS Code sidebar
- 🔄 **Auto-refresh** - Configurable automatic secrets synchronization
- 📈 **Telemetry** - Optional usage analytics (disabled by default)

## Quick Start

### Prerequisites

- VS Code 1.74.0 or higher
- Node.js 18.x or higher
- Infisical account with Universal Auth credentials

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd infisical-ai-vscode
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run compile
   ```

4. Run the extension in development mode:
   - Press `F5` to open a new Extension Development Host window
   - Or use the "Run Extension" configuration in VS Code debugger

### First-time Setup

1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run `Infisical AI: Login to Infisical`
3. Enter your Infisical Universal Auth credentials:
   - Client ID
   - Client Secret
4. Select your project and environment
5. Start managing your secrets!

## Usage

### Authentication

The extension supports Infisical Universal Auth:

1. **Command Palette Login**: Use `Infisical AI: Login to Infisical`
2. **Control Panel**: Use `Infisical AI: Open Control Panel` for web-based login
3. **Activity Bar**: Click "Login to Infisical" in the Infisical AI sidebar

### Managing Secrets

#### Via Tree View
- Browse secrets in the Infisical AI Activity Bar
- Right-click secrets for context menu actions
- Use toolbar buttons for bulk operations

#### Via Control Panel
- Open the Control Panel for a comprehensive web interface
- Select projects and environments
- View, create, and manage secrets

#### Via Commands
- `Infisical AI: Create Secret` - Add a new secret
- `Infisical AI: Refresh Secrets` - Sync with Infisical
- `Infisical AI: Auto-fix Missing Secrets` - AI-powered secret detection

### AI Features

- **Explain Usage**: Get AI explanations for secret usage patterns
- **Auto-fix Missing**: Automatically detect and suggest missing secrets
- **Smart Diff**: Intelligent comparison of secret changes
- **Natural Language Actions**: Describe what you want to do in plain English

## Configuration

Configure the extension via VS Code settings:

```json
{
  "infisicalAi.baseUrl": "https://us.infisical.com",
  "infisicalAi.telemetryEnabled": false,
  "infisicalAi.autoRefreshInterval": 300000,
  "infisicalAi.maxRetries": 3
}
```

### Settings Reference

| Setting | Default | Description |
|---------|---------|-------------|
| `infisicalAi.baseUrl` | `https://us.infisical.com` | Infisical API base URL |
| `infisicalAi.telemetryEnabled` | `false` | Enable usage analytics |
| `infisicalAi.autoRefreshInterval` | `300000` | Auto-refresh interval (ms, 0 to disable) |
| `infisicalAi.maxRetries` | `3` | Maximum API retry attempts |

## Development

### Project Structure

```
src/
├── extension.ts              # Main extension entry point
├── api/
│   └── InfisicalApi.ts      # API wrapper with retry logic
├── providers/
│   ├── SecretsProvider.ts   # Tree view data provider
│   ├── AuthProvider.ts      # Authentication tree provider
│   └── ControlPanelProvider.ts # Webview panel provider
├── utils/
│   ├── TokenStore.ts        # Secure token storage
│   ├── TelemetryService.ts  # Analytics service
│   └── ErrorHandler.ts      # Centralized error handling
└── webview/
    ├── index.tsx            # React entry point
    ├── ControlPanel.tsx     # Main React component
    └── ControlPanel.css     # Webview styles
```

### Build Scripts

```bash
npm run compile          # Build for production
npm run watch           # Watch mode for development
npm run dev             # Development build
npm run lint            # Run ESLint
npm run test            # Run tests
npm run package         # Create VSIX package
```

### Testing

Run the extension in development mode:

1. Open VS Code in the project directory
2. Press `F5` to launch Extension Development Host
3. Test all features in the new window

### Packaging

Create a VSIX package for distribution:

```bash
npm run package
```

This generates `infisical-ai-<version>.vsix` for installation.

## Security

- **No Secrets in Code**: Never commit actual secrets or credentials
- **Secure Storage**: Tokens stored in VS Code's secure storage
- **HTTPS Only**: All API communication uses HTTPS
- **Input Validation**: All user inputs are validated and sanitized

## Environment Variables

For local development, copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

**Note**: The `.env` file is for local development environment variables only, NOT for secrets.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

[License information here]

## Support

- GitHub Issues: [Create an issue](https://github.com/infisical/infisical-ai-vscode/issues)
- Documentation: [VS Code Extension Docs](https://code.visualstudio.com/api)
- Infisical Docs: [https://infisical.com/docs](https://infisical.com/docs)