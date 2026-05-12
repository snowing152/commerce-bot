# Coupang Bot

A Windows desktop app that automates product searches on [Coupang](https://www.coupang.com) (Korean e-commerce). Enter a keyword and target product name, and the bot drives a locally-installed Chrome/Edge browser over CDP, applies filters, paginates through results, adds the matching product to the cart, and captures a screenshot of the cart.

Auth and subscription gating use Telegram (for login) and Supabase (for token/subscription storage).

## Build & run

```
# Install dependencies
npm install

# Development (hot-reload with electron-vite)
npm run dev

# Build + launch (production bundle, no installer)
npm run build && npm start

# Package as NSIS installer (Windows x64)
npm run pack

# Run tests
npm test
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values before building:

```
cp .env.example .env
```

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key (not service_role) |
| `BOT_USERNAME` | Telegram bot username (without `@`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for log exports |
| `TELEGRAM_LOG_CHAT_ID` | Telegram chat ID that receives log exports |

Variables are injected at build time via `electron.vite.config.ts` — they are **not** loaded from `.env` at runtime.

## Known limitations

See [CLAUDE.md](CLAUDE.md) for a full list of known issues and architectural notes.
