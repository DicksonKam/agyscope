# AGYScope

A private, local usage observatory and native macOS menu bar meter for **Google Antigravity**. Built in the same local-first family as **CDXScope** (Codex) and [CCScope](https://github.com/DicksonKam/ccscope) (Claude Code), designed specifically around Antigravity's 5-hour rolling windows, overarching weekly ceiling, per-model quota pools, Google One AI Credits fallback, and agentic work footprint.

AGYScope is an independent project, not affiliated with or endorsed by Google.

**Status: early preview, source builds only.** It is not a signed or notarized download.

## How It Reads Your Usage

Once a minute, AGYScope asks the official Antigravity CLI (`agy`) for its structured usage report:

```sh
agy -p /usage --output-format json
```

`agy` answers locally with `num_turns: 0` and `total_tokens: 0`, so polling costs zero tokens. If a future CLI release ever spends model tokens answering `/usage`, AGYScope stops CLI reads automatically.

Two additional local sources add detail:

- **StatusLine tap (`npm run tap -- install`):** Optional hook for `~/.gemini/antigravity-cli/settings.json` that captures allowlisted `quota` fields piped by `agy` while chaining any existing status line command.
- **Local transcripts:** Incrementally scans `~/.gemini/antigravity/brain` and `~/.gemini/antigravity-cli/brain`, retaining only numeric token counters, model labels, and machine tool names (never prompts, replies, or thinking). See [PRIVACY.md](PRIVACY.md).

## Highlights

- **Living Antigravity Logo (Menu Bar):** The swooping Antigravity silhouette fills bottom-to-top with your **5-hour remaining %**, paired with a bold **5h%** readout and a quiet stacked **WK / %** beside it. Clean native macOS monochrome when healthy, with semantic alert tints for low 5h (`<15%` amber), AI Credits fallback (violet `+`), and weekly cap reached (coral).
- **Mission Control Popover (`P3`):** Click the menu bar icon for your 5-hour & Weekly balance, AI Credits state, interactive Swift Charts allowance history (`Current` / `7d` / `30d` / `90d`), and a live **"This 5h window"** strip showing conversations, subagents/swarms, browser runs, and artifacts.
- **Prismatic Obsidian Web Observatory (`http://127.0.0.1:4337`):** Quiet monochrome dark/light surfaces with the Gemini spectrum reserved for live meters across 3 pages:
  1. **Quota & Runway** *(landing page)* — 5-hour vs. Weekly ceiling interaction, reset countdowns, AI Credits fallback, monitoring health, and allowance history.
  2. **Agents & Work** — This 5-hour window footprint, all-time token & cache totals, and recent pseudonymous sessions.
  3. **Models & Tools** — Per-model quota pools, local model usage, Antigravity App vs. CLI split, and top invoked tools.
- **Zero credentials read:** AGYScope never touches OAuth tokens or Google endpoints directly. Local activity comes from allowlisted metadata in Antigravity brain transcripts; live quota comes from the official `agy` CLI (`statusLine` tap and/or zero-token `/usage` check).

## Setup

Requires macOS 13+, Node.js 22.13+, and Apple Command Line Tools (for the native menu bar app).

```sh
npm ci --ignore-scripts
npm run build
npm run probe                 # scan local Antigravity transcripts
npm start                     # run service at http://127.0.0.1:4337
```

Preview all 3 pages, history charts, and menu bar states immediately with synthetic data:

```sh
npm run demo
```

Install the native macOS menu bar app (`~/Applications/AGYScope.app`) and background LaunchAgent:

```sh
npm run menubar -- install
npm run doctor
```

If you use the official Antigravity CLI (`agy`), install the statusLine hook (backs up `~/.gemini/antigravity-cli/settings.json` and chains any existing statusLine):

```sh
npm run tap -- install
```

## Commands

```sh
npm test                      # Node unit & privacy-invariant tests
npm run test:macos            # Native Swift menu bar & chart tests
npm run check                 # TypeScript strict check
npm run doctor                # Read-only health check
npm run menubar -- build      # Compile & ad-hoc sign AGYScope.app under .local
npm run menubar -- uninstall  # Move app & login plist to Trash (keeps history)
npm run service -- uninstall  # Move service login plist to Trash (keeps history)
npm run tap -- uninstall      # Restore previous agy statusLine settings
```

## License

[MIT](LICENSE)
