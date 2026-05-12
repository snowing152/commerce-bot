# Coupang Bot

A Windows desktop app that automates product searches on [Coupang](https://www.coupang.com) (Korean e-commerce platform). The bot drives a real Chrome/Edge browser, applies filters, paginates through search results, adds the matching product to the cart, and captures a screenshot of the final cart.

---

## Requirements

- Windows 10/11 (x64)
- Google Chrome or Microsoft Edge installed
- A Telegram account (used for login)
- An active subscription

---

## Installation

Download and run the latest `.exe` installer from the Releases page. The app installs to `%LocalAppData%` and creates a shortcut in the Start Menu.

On first launch the app copies its default config to `%AppData%\coupang-bot\`.

---

## Getting started

### 1. Login

The app uses Telegram for authentication.

1. Click **Login with Telegram** on the auth screen
2. The Telegram bot opens in your browser — press **Start** inside the bot
3. Return to the app — it polls for confirmation and logs you in automatically

### 2. Subscription

After login the app checks your subscription status. If it is expired you are redirected to the subscription page where you can renew via the payment bot.

The subscription page shows:
- Plan name and price
- Expiry date and days remaining
- A **Renew** button that opens the Telegram payment bot

---

## Main dashboard

The dashboard is split into three areas: the **top bar**, the **task list** (left), and the **log/results panel** (right).

### Top bar

| Element | Description |
|---------|-------------|
| Version badge | Shows the current app version (`v2.x.x`) |
| Update status | Shows auto-updater progress (checking, downloading, ready) |
| User avatar + name | Your Telegram display name and profile photo |
| Language switcher | Toggle between supported UI languages |
| Subscription button | Opens the subscription page |
| Logout button | Logs out and returns to the auth screen |

---

## Tasks

Tasks are what the bot searches for. Each task has a **keyword** (the search query) and a **target product name** (the product to match in the results).

### Adding a task

- Click **New Task** in the task list header, or press `Ctrl+N` / `⌘N`
- Enter:
  - **Keyword** — the search term typed into Coupang's search bar (e.g. `고양이 낚시대 장난감`)
  - **Product** — the exact product name to match in results
- Click **Create**

### Editing a task

- Right-click any task in the list → **Edit**
- Modify the keyword or product name → **Save**

### Deleting a task

- Right-click a task → **Delete**
- Confirm deletion in the second click (the button turns red as a confirmation step)

### Task statuses

| Badge | Meaning |
|-------|---------|
| idle | Not currently running |
| running | Actively being searched |
| warn | Task completed with a warning |
| error | Task failed |

---

## Running the bot

### Start

Click **Start** in the bottom bar (or wait for a scheduled run). All tasks run sequentially. The bot will:

1. Open Chrome/Edge minimized in the taskbar
2. Navigate to Coupang and apply any search filters
3. Paginate through results up to the configured `max_pages_to_search` limit
4. Match the target product name using fuzzy matching
5. Add the matched product to the cart
6. Take a screenshot of the cart

### Pause

Click **Pause** to suspend the current run between tasks. The bot finishes its current page before pausing.

### Stop

Click **Stop** to cancel the run. The bot finishes the current action and exits cleanly.

### View screenshot

After a successful run a **View Screenshot** button appears in the bottom bar. Click it to open the cart screenshot in File Explorer.

---

## Log tab

The **Log** tab (right panel, default) shows a real-time stream of everything the bot does.

### Log levels

| Level | Color | Meaning |
|-------|-------|---------|
| INFO | Gray | General status messages |
| ACTION | Gray | Browser interactions (clicks, typing) |
| SUCCESS | Green | Product found or task completed |
| WARN | Yellow | Non-fatal issues (e.g. page took longer than expected) |
| ERROR | Red | Failures |
| DEBUG | Muted | Verbose internal detail |

### Filtering logs

Use the level buttons above the log list to show only specific levels. **ALL** resets the filter.

---

## Results tab

The **Results** tab shows every product the bot has successfully found, grouped by run.

Each row shows:
- Run number
- Date/time
- Keyword
- Product name found
- Location in the cart

### Search results

Use the search box at the top of the results tab to filter by keyword or product name.

### Export to CSV

Click **Export CSV** to save all results as a `.csv` file. A save dialog lets you choose the location.

### Clear results

Click **Clear** (with confirmation) to delete all saved results permanently.

---

## Scheduled search

The bot can run automatically in the background on a fixed interval without any manual interaction.

### Setting up a schedule

1. Click the **clock icon** (⏰) in the bottom bar
2. Check **Enable automatic scheduled runs**
3. Select an interval: **1h / 2h / 3h / 6h / 12h / 24h**
4. Click **Save**

The modal also shows **Next run in: Xh Ym** when a schedule is active.

### Background operation

Close the app window — it hides to the **system tray** (bottom-right corner of the taskbar) instead of quitting. The scheduler keeps running silently in the background.

**Tray icon actions:**
- **Double-click** — restore the window
- **Right-click → Open** — restore the window
- **Right-click → Quit** — fully exit the app and stop all scheduled runs

### Notifications

When a scheduled run fires you receive a Windows toast notification:
- **"Scheduled search starting…"** — run has begun
- **"Scheduled search complete."** — run has finished

Notifications appear even when the app window is hidden.

### Chrome behavior during scheduled runs

Chrome opens **minimized** (in the taskbar, not the foreground) so it does not interrupt your work. It closes automatically when the run finishes.

### Schedule persistence

The schedule is saved to `config.json` and restored automatically the next time you launch the app. If it was enabled when you last closed the app, it starts running again immediately.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` / `⌘N` | New task |
| `Escape` | Close any open modal |

---

## Auto-updates

The app checks for updates on launch via GitHub Releases. When an update is downloaded it installs automatically and restarts within 3 seconds. Update progress is shown in the top bar.

---

## Build & development

```bash
# Install dependencies
npm install

# Development (hot-reload)
npm run dev

# Production build (no installer)
npm run build && npm start

# Package as NSIS installer (Windows x64)
npm run pack

# Run tests
npm test

# Clean build artifacts
npm run clean
```

### Environment variables

Copy `.env.example` to `.env` and fill in values before building. Variables are injected at build time — they are **not** read from `.env` at runtime in the packaged app.

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `BOT_USERNAME` | Telegram bot username (without `@`) |
| `TELEGRAM_BOT_TOKEN` | Bot token for log exports |
| `TELEGRAM_LOG_CHAT_ID` | Chat ID that receives exported logs |

### User data location

All runtime files are stored in `%AppData%\coupang-bot\`:

| File | Contents |
|------|----------|
| `config.json` | Browser path, tasks, schedule config |
| `selectors.json` | DOM selectors (overwritten on every launch) |
| `saved_session.json` | Last task list (restored on next launch) |
| `saved_results.json` | Persisted bot results (up to 500) |
| `bot_log.txt` | Full log of the last run |
| `screenshots/` | Cart screenshots |

---

## Known limitations

See [CLAUDE.md](CLAUDE.md) for a full list of known issues and architectural notes.
