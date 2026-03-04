#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { renderGotchi } from "./render-gotchi-bypass.mjs";

const DAPP_BASE = "https://www.aavegotchi.com";
const DEFAULT_VIEW = "front";
const DEFAULT_WINDOW_SIZE = 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const ORBIT_BY_VIEW = {
  front: "0deg 75deg 120%",
  left: "-90deg 75deg 120%",
  right: "90deg 75deg 120%",
  back: "180deg 75deg 120%"
};

function parseArgs(argv) {
  const args = {
    tokenId: null,
    inventoryUrl: null,
    outDir: "/tmp",
    view: DEFAULT_VIEW,
    browserPath: null,
    windowSize: DEFAULT_WINDOW_SIZE,
    pollAttempts: null,
    pollIntervalMs: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--token-id" && next) {
      args.tokenId = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--inventory-url" && next) {
      args.inventoryUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--out-dir" && next) {
      args.outDir = next;
      i += 1;
      continue;
    }
    if (arg === "--view" && next) {
      args.view = String(next).toLowerCase();
      i += 1;
      continue;
    }
    if (arg === "--browser-path" && next) {
      args.browserPath = next;
      i += 1;
      continue;
    }
    if (arg === "--window-size" && next) {
      args.windowSize = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--poll-attempts" && next) {
      args.pollAttempts = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--poll-interval-ms" && next) {
      args.pollIntervalMs = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/render-gotchi-view.mjs --token-id <id> [--view left|right|back|front]
  node scripts/render-gotchi-view.mjs --inventory-url "<url>" [--view left|right|back|front]

Options:
  --token-id         Numeric gotchi token id
  --inventory-url    Inventory URL containing id=<tokenId>
  --view             front|left|right|back (default: front)
  --out-dir          Output folder for JSON and PNG files (default: /tmp)
  --browser-path     Explicit Chrome/Chromium executable path
  --window-size      Square screenshot size in px (default: 1024)
  --poll-attempts    Passed through to render-gotchi-bypass.mjs
  --poll-interval-ms Passed through to render-gotchi-bypass.mjs
`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getGlbProxyUrl(summary) {
  if (!summary.responseFile || !fs.existsSync(summary.responseFile)) {
    throw new Error("Bypass response file missing; cannot resolve GLB proxy URL.");
  }

  const batchJson = JSON.parse(fs.readFileSync(summary.responseFile, "utf8"));
  const proxyPath = batchJson?.data?.results?.[0]?.proxyUrls?.GLB_3DModel;
  if (!proxyPath) {
    throw new Error("GLB proxy URL missing from batch response.");
  }

  return proxyPath.startsWith("http") ? proxyPath : `${DAPP_BASE}${proxyPath}`;
}

function resolveBrowserPath(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Chrome/Chromium executable not found. Install Chrome or pass --browser-path."
  );
}

function buildHtml(glbUrl, view) {
  const orbit = ORBIT_BY_VIEW[view] || ORBIT_BY_VIEW.front;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: #ffffff; overflow: hidden; }
      model-viewer { width: 100vw; height: 100vh; --poster-color: transparent; }
    </style>
    <script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"></script>
  </head>
  <body>
    <model-viewer
      id="mv"
      src="${escapeHtml(glbUrl)}"
      camera-controls
      camera-orbit="${escapeHtml(orbit)}"
      field-of-view="30deg"
      exposure="1.05"
      shadow-intensity="0"
      interaction-prompt="none">
    </model-viewer>
    <script>
      const mv = document.getElementById("mv");
      mv.addEventListener("load", () => {
        document.body.dataset.ready = "1";
      });
      mv.addEventListener("error", () => {
        document.body.dataset.error = "1";
      });
    </script>
  </body>
</html>`;
}

async function renderViewImage({ glbUrl, outPath, browserPath, view, windowSize }) {
  let puppeteer;
  try {
    ({ default: puppeteer } = await import("puppeteer-core"));
  } catch {
    throw new Error("Missing dependency 'puppeteer-core'. Run `npm install` first.");
  }

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: [
      "--disable-gpu",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: windowSize, height: windowSize });
    await page.setContent(buildHtml(glbUrl, view), {
      waitUntil: "networkidle0",
      timeout: DEFAULT_TIMEOUT_MS
    });
    await page.waitForFunction(
      () => document.body?.dataset?.ready === "1" || document.body?.dataset?.error === "1",
      { timeout: DEFAULT_TIMEOUT_MS }
    );

    const renderState = await page.evaluate(() => ({
      ready: document.body?.dataset?.ready,
      error: document.body?.dataset?.error
    }));
    if (renderState.error === "1") {
      throw new Error("model-viewer reported a GLB load/render error.");
    }

    await page.screenshot({ path: outPath, type: "png" });
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!Number.isInteger(options.tokenId) && !options.inventoryUrl) {
    printHelp();
    throw new Error("Provide --token-id <id> or --inventory-url with id=<tokenId>.");
  }
  if (!Object.hasOwn(ORBIT_BY_VIEW, options.view)) {
    throw new Error(`Unsupported --view '${options.view}'. Use front|left|right|back.`);
  }
  if (!Number.isInteger(options.windowSize) || options.windowSize < 256) {
    throw new Error("--window-size must be an integer >= 256.");
  }

  fs.mkdirSync(options.outDir, { recursive: true });

  const summary = await renderGotchi(options);
  let viewImagePath = summary?.artifacts?.fullPngPath || null;
  let browserPath = null;

  if (options.view !== "front") {
    const glbUrl = getGlbProxyUrl(summary);
    browserPath = resolveBrowserPath(options.browserPath);
    viewImagePath = path.join(options.outDir, `gotchi-${summary.tokenId}-${options.view}.png`);
    await renderViewImage({
      glbUrl,
      outPath: viewImagePath,
      browserPath,
      view: options.view,
      windowSize: options.windowSize
    });
  }

  const result = {
    ...summary,
    view: options.view,
    viewImagePath,
    browserPath
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
