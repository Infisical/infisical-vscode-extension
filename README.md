# Infisical for VS Code

Browse and manage your [Infisical](https://infisical.com) secrets without leaving VS Code.

## Features

- Tree view of every project, environment, folder, and secret you can access.
- Reveal, copy, edit, create, and delete secrets from the sidebar.
- User login against Infisical Cloud (US/EU) or any self-hosted instance.

## Getting started

1. Install the extension and open the **Infisical** activity bar icon.
2. Click **Login to Infisical** and enter your Universal Auth Client ID and Client Secret.
3. Expand a project → environment → folder to view secrets. Click any secret to reveal, copy, edit, or delete it.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `infisical.baseUrl` | `https://us.infisical.com` | API base URL. Set this to your self-hosted instance if you don't use the US or EU regions. |

## Development

```bash
npm install
npm run dev      # webpack in watch mode
npm test         # vitest
```

Press `F5` in VS Code to launch the Extension Development Host.
