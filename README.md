# aavegotchi-3d-render-skill

Render Aavegotchi assets from token data and renderer batch APIs.

This skill derives the renderer hash directly from Goldsky Base core subgraph data, then calls `POST /api/renderer/batch` on `www.aavegotchi.com` with `force:true`, polls `verify:true` until assets are available, and downloads image artifacts.

It also supports angle renders (`front`, `left`, `right`, `back`) from the returned GLB using headless Chrome.

Skill name: `aavegotchi-3d-renderer`.

## Files

- `SKILL.md`: publishable skill definition.
- `scripts/render-gotchi-bypass.mjs`: executable helper script used by the skill.
- `scripts/render-gotchi-view.mjs`: wrapper that adds angle renders from GLB output.

## Quick Start

```bash
node scripts/render-gotchi-bypass.mjs --token-id 6741
```

Or from an inventory URL:

```bash
node scripts/render-gotchi-bypass.mjs \
  --inventory-url "https://www.aavegotchi.com/u/0x.../inventory?itemType=aavegotchis&chainId=8453&id=6741"
```

Artifacts are written to `/tmp` by default:

- `/tmp/gotchi-<id>-render-batch-kickoff.json`
- `/tmp/gotchi-<id>-render-batch.json`
- `/tmp/gotchi-<id>-full.png`
- `/tmp/gotchi-<id>-headshot.png`

Use `--out-dir <path>` to override output location.
Use `--poll-attempts <n>` and `--poll-interval-ms <ms>` to tune polling behavior.

### Angle Render (left/right/back)

Install dependencies once:

```bash
npm install
```

Generate a left-side profile:

```bash
node scripts/render-gotchi-view.mjs --token-id 6741 --view left
```

Angle artifacts are written as:

- `/tmp/gotchi-<id>-left.png` (or `right`, `back`, `front`)

Use `--browser-path` when Chrome is not in a standard location.

## Notes

- Default target chain is Base (`chainId=8453`).
- Goldsky endpoint and renderer API URLs are embedded in the script.
- For full behavior and troubleshooting, see `SKILL.md`.
