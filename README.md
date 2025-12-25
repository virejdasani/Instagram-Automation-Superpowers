# Instagram AutoFollow

Small Chrome extension to automate following users from an Instagram followers list and record metrics locally.

**Location**: `/Users/virej/Desktop/Code/All-My-Projects/Extensions/Browser/InstagramAutoFollow/`

**Warning:** Automating actions on Instagram may violate Instagram's Terms of Service and can lead to account limits, suspension, or bans. Use at your own risk and keep conservative settings.

**Features**
- **Automated follow clicks**: Injects a content script into `https://www.instagram.com/*` that finds visible `Follow` buttons and clicks them.
- **Modal-aware scrolling**: Detects the followers modal's inner scrollable container and scrolls it so more users load (scrolls modal, not just the page).
- **Username extraction**: Attempts to discover the username associated with a clicked follow by inspecting nearby anchor `href` values (e.g., `/username/`). Saves username + timestamp for metrics.
- **Local metrics storage**: Stores followed accounts in `chrome.storage.local` under `followedAccounts` as objects `{ username, ts }`.
- **Popup UI controls**: A popup (`popup.html`) lets you Start/Stop the automation, adjust the base interval, `perTick` count, scroll amount, enable randomization (jitter), and set jitter in ms.
- **Rate-limiter & randomized delays**: The content script uses a safer run loop with sequential per-click gaps and optional jitter to avoid bursty behavior and better mimic human timing.
- **Persisted options**: Popup saves auto-follow options under `autoFollowOptions` in `chrome.storage.local` so settings persist between runs.
- **Clear list**: Popup provides a `Clear List` button to remove stored followed accounts.

Files
- `manifest.json` — extension manifest (MV3) and content script registration
- `content.js` — injected content script: finds Follow buttons, clicks, extracts usernames, scrolls modal, stores metrics, accepts messages (`start`, `stop`, `status`, `getList`)
- `popup.html` — popup UI
- `popup.css` — popup styles
- `popup.js` — popup logic (send `start`/`stop` messages, persist/load options, display followed accounts)

Installation (developer mode)
1. Open Chrome or Chromium.
2. Navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and choose the folder:

```bash
# macOS / zsh
cd /Users/virej/Desktop/Code/All-My-Projects/Extensions/Browser/InstagramAutoFollow
```

Usage
1. Open Instagram in your browser and navigate to an account's profile.
2. Click the `Followers` link to open the followers dialog/modal.
3. Open the extension popup (from the toolbar).
4. Configure options:
   - `Interval (ms)`: Base delay between ticks (a tick runs `perTick` follow attempts).
   - `Per tick`: How many follow clicks to attempt each tick (recommended: 1).
   - `Scroll amount (px)`: How many pixels to scroll/nudge the followers container after clicks (tweak if new entries don't load).
   - `Randomize intervals`: Add jitter to the `Interval (ms)`.
   - `Jitter (ms)`: Maximum jitter applied to the interval when randomize is enabled.
5. Click `Start`. The popup will send a `start` message to the content script with the current options; the content script begins a run loop, clicking follow buttons and saving results.
6. Click `Stop` to stop automation. Use `Clear List` to remove the stored followed accounts.

Recommended conservative settings
- `Interval (ms)`: 3000–10000
- `Per tick`: 1
- `Randomize intervals`: enabled
- `Jitter (ms)`: 500–2000

Command/Message API (used internally)
- `start` — { command: 'start', intervalMs, perTick, options } — starts the run loop and merges `options` into runtime settings.
- `stop` — { command: 'stop' } — stops the run loop.
- `status` — { command: 'status' } — returns { running: bool, settings }
- `getList` — { command: 'getList' } — responds with the `followedAccounts` array from storage.

Data storage
- Followed accounts are stored in Chrome extension storage at key `followedAccounts` as an array of objects: `{ username: string, ts: number }`.
- Options are stored at `autoFollowOptions`.

Troubleshooting
- If no scrolling occurs:
  - Ensure the followers modal is open; automation detects scrollable elements inside `[role="dialog"]`.
  - Increase `Scroll amount (px)` in the popup.
  - If Instagram updated its DOM structure, the detection heuristic may fail — open the DevTools console and evaluate `window.igAutoFollow` while the followers modal is open to inspect the cached `scrollContainer`.
- If the script clicks the wrong buttons or doesn't extract usernames reliably:
  - Instagram's DOM structure changes frequently; the extension uses button innerText matching and nearby anchor href parsing which is more robust than class names but not perfect.

Limitations & Risks
- Automating interactions may violate Instagram Terms of Service.
- Instagram may detect automation; this extension includes jitter and rate-limits but cannot guarantee safety.
- Username extraction is heuristic-based and may miss or mis-identify users in some DOM variations.

Extensibility / Next steps (ideas)
- Add CSV/JSON export of `followedAccounts` from the popup.
- Add a daily follow cap and automatic stop when the cap is reached.
- Add a live activity log in the popup showing recent actions.
- Improve username extraction and add fallback strategies.

Developer notes
- The content script exposes a debugging object on the page, `window.igAutoFollow`, containing `.settings`, `.running`, `.start()`, `.stop()`, and `.scrollContainer` (when detected). You can inspect this from DevTools Console when the extension is active.

License / Attribution
- This is a simple personal tool and comes with no warranty. Use responsibly.
