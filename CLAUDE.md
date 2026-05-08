# CLAUDE.md

Guidance for Claude Code working in this repo. Keep this short and current.

## What this is

A Windows Electron desktop app that automates Coupang (Korean e-commerce). The user enters search tasks (keyword + target product name + optional filters + price bands). The app drives a real Chrome/Edge install over CDP via **patchright** (a Playwright fork), applies filters, scans result pages for a matching product, adds it to the cart, and screenshots the final cart. Auth and subscription gating go through Telegram + Supabase.

Packaged and distributed as an NSIS installer via `electron-builder` with GitHub-backed auto-updates (`electron-updater`).

## Tech stack

- **Runtime:** Electron 41, Node 20 types, TypeScript 5.9 (strict), CommonJS modules
- **Browser automation:** `patchright` (Playwright fork) over CDP against a locally-installed Chrome/Edge
- **Backend / data:** Supabase (auth tokens, users, `subscription_status_live` view, `not_found_products`)
- **Auth UX:** deep-link to Telegram bot (`shell.openExternal`) — the bot confirms a one-time token row; app polls Supabase
- **State:** `electron-store` for `{telegram_id, session}`; plain JSON files in `app.getPath("userData")` for config/selectors/logs/session
- **Tests:** Jest + ts-jest (node env, no DOM)
- **Build:** `tsc` → `dist/`, HTML copied via `copyfiles`, packaged with `electron-builder --win --x64`

## Layout

- [src/main.ts](src/main.ts) — Electron main process: IPC handlers, window creation, `setupUserFiles` (merges default config into user dir), auto-updater with exponential-backoff retry
- [src/engine.ts](src/engine.ts) — `AutomationEngine` (1383 lines — the big one). Launches browser, connects over CDP, per-task: search → `applyFilters` → `applyCost` → paginate → match → add to cart → screenshot. Also owns Supabase `not_found_products` reporting with local JSONL fallback
- [src/utils.ts](src/utils.ts) — `Humanizer` (random waits, mouse moves, simulated reading), `getFreePort`, CDP readiness probes
- [src/auth-service.ts](src/auth-service.ts) — Supabase-backed `startTelegramAuth` / `checkAuthToken` / `confirmAuthToken` / `getSubscriptionStatus` / `extendSubscription`
- [src/preload.ts](src/preload.ts) — `contextBridge` API surface
- [src/auth.html](src/auth.html), [src/subscription.html](src/subscription.html), [src/index.html](src/index.html) — renderer pages (three-page flow)
- [config/](config/) — `config.json` (defaults, copied to userData on first run) and `selectors.json` (DOM selectors, overwritten on every launch)
- `.env` at project root, loaded relative to `__dirname/../.env` (dev-only path; see problem #5 below)

## Scripts

```
npm run build    # tsc + copy HTML into dist/
npm start        # build then electron .
npm run pack     # clean + build + electron-builder --win --x64
npm test         # jest (uses tsconfig.test.json)
npm run clean    # rm dist/ and release/
```

## Config / file flow

1. First launch: `setupUserFiles()` copies bundled `config/config.json` → `userData/config.json`.
2. Subsequent launches: it **merges** fresh defaults with the user's existing `browser_path` and `tasks`, then **always overwrites** `userData/selectors.json` from the bundle.
3. `ipcMain.on("start-bot")` writes the task list back into `userData/config.json`, then `AutomationEngine.run()` reads it.
4. Engine writes: `bot_log.txt`, `not_found.jsonl`, `screenshots/*.png`, `debug_port.lock`, and a throwaway Chromium profile in `chrome_debug_profile/`.

## IPC surface (renderer ⇄ main)

Defined in [src/preload.ts](src/preload.ts) + [src/main.ts](src/main.ts). When adding a channel, register both sides — see problem #4 below.

Active: `start-bot`, `bot-log`, `bot-done`, `bot-result`, `save-session`, `load-session`, `send-log-telegram`, `open-path`, `update-status`, `update-progress`, `update-error`, `get-version`, `get-bot-username`, `get-subscription-status`, `open-payment-bot`, `navigate-to`, `logout`, `start-telegram-auth`, `check-auth-token`.

## Known problems (worth flagging to the user before touching related code)

1. **Live-looking secrets in the working copy.** [config/config.json](config/config.json) contains a Supabase JWT whose `role` claim is `service_role`, plus a Telegram `bot_token`. The file is gitignored now (commit `a7db6a9`) but may still be in earlier git history. These should be rotated and pulled out of the default bundled config.
2. **`supabase_allow_service_role: true`** in the same file defeats the engine.ts:218 safeguard that's specifically there to stop a `service_role` key from being shipped to end users.
3. **`engine.ts` is a 1383-line god class** mixing browser lifecycle, config I/O, filter DSL, pagination, Supabase reporting, and screenshotting. Any non-trivial change benefits from extracting at least the filter/pagination logic.
4. **Dead IPC channel.** `preload.ts:33` exposes `loginWithTelegram` → invokes `"login-with-telegram"`, but `main.ts` has no handler for it. Either remove from preload or implement.
5. **`.env` loading won't work in the packaged app.** `main.ts:3` resolves `.env` relative to `__dirname/../.env`, which in the asar-packaged build points inside `resources/app.asar/..` — not a file that ships. In prod, env vars only come from whatever the user's OS provides; `auth-service.ts:12` will throw `"Missing Supabase env vars"` unless they're set some other way.
6. **Selectors are clobbered every launch** (`main.ts:239-241`), so any local tweak to `userData/selectors.json` is lost on the next start. Config is properly merged; selectors should either merge similarly or be read-only.
7. **Conflicting browser flags.** `engine.ts:407-419` passes `--incognito`, `-inprivate`, `--private` together. Chrome ignores `--incognito` when `--user-data-dir` is set (and `-inprivate`/`--private` are Edge/non-standard). The "incognito" intent doesn't actually take effect.
8. **Detached + kill on Windows.** The browser is spawned with `detached: true` + `child.unref()` (`engine.ts:426-432`) and later killed with `child.kill()` (`engine.ts:1378`). On Windows this doesn't reliably kill the process tree; child tabs/helpers can linger.
9. **Unused state.** `pendingTokens` map at `auth-service.ts:19` is never read — leftover from an earlier auth design.
10. **User-facing strings mix Russian, Korean, and English.** Auto-updater status strings are Russian (`main.ts:289-367`); filter matching hardcodes Korean (`"품절"`, `"더보기"`, `"새 상품"` in `engine.ts`). Not a bug, but worth knowing before changing copy.
11. **README is a one-line placeholder.**

## Conventions

- TypeScript strict mode is on — don't loosen it. Prefer narrowing over `as any`; existing `as any` usages are mostly at IPC boundaries and in tests probing private members.
- Logs flow through `AutomationEngine.logStep(level, message, context?)`. Levels: `INFO | DEBUG | WARN | SKIP | ACTION | SUCCESS | ERROR`. Don't `console.log` directly inside the engine — the logger also writes to `bot_log.txt` and forwards to the UI.
- Wrap Playwright calls that can race against page navigation in `safeExecute(promise, context, fallback)` to keep the run alive.
- All file I/O belongs under `userDataPath` (write-safe) — never inside `__dirname` when the app is packaged (asar is read-only).
- Tests live next to source as `*.test.ts`; they're excluded from the app build via `tsconfig.json` and use `tsconfig.test.json`.