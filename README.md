# JohnAI

JohnAI is a responsive web chat UI for your local [Hermes Agent](https://hermes-agent.nousresearch.com/) backend. Hermes runs the agent (tools, skills, sessions); JohnAI is the front door on phone, tablet, and desktop.

## Prerequisites

1. Hermes installed and configured (OpenRouter or another provider).
2. Hermes API server enabled in `%LOCALAPPDATA%\hermes\.env` (Windows) or `~/.hermes/.env`:

```env
API_SERVER_ENABLED=true
API_SERVER_KEY=your-local-secret
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000
```

3. Start the gateway:

```bash
hermes gateway
```

Health check: `http://127.0.0.1:8642/health`

## Run JohnAI

```bash
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`).

In **Settings**, set:

- Base URL: `http://127.0.0.1:8642`
- API key: the same `API_SERVER_KEY` value

Keys stay in your browser `localStorage` — they are not committed to git.

## Features

- Streaming chat against Hermes (`/v1/chat/completions` + session stream when available)
- Session list (local), tool-progress chips, capabilities / skills / toolsets panel
- Responsive layout for mobile and desktop
- Stop in-flight runs

## Scripts

- `npm run dev` — local Vite server
- `npm run build` — production build
- `npm run preview` — preview production build

## Note

Hermes executes tools server-side. JohnAI is a client UI; keep the API key private and bind Hermes to localhost unless you know you need remote access.
