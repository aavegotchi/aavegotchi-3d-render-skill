#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { renderGotchi } from "./render-gotchi-bypass.mjs";

const DAPP_BASE = "https://www.aavegotchi.com";
const DEFAULT_VIEW = "front";
const DEFAULT_WINDOW_SIZE = 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const CAMERA_DIRECTION_BY_VIEW = {
  front: [0, 0, 1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  back: [0, 0, -1]
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
  const direction = CAMERA_DIRECTION_BY_VIEW[view] || CAMERA_DIRECTION_BY_VIEW.front;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: #ffffff; overflow: hidden; }
      canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; }
      #out { display: none; }
    </style>
    <script type="importmap">
      {
        "imports": {
          "three": "https://unpkg.com/three@0.160.0/build/three.module.js"
        }
      }
    </script>
  </head>
  <body>
    <canvas id="gl"></canvas>
    <canvas id="out"></canvas>
    <script type="module">
      import * as THREE from "three";
      import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

      const glCanvas = document.getElementById("gl");
      const outCanvas = document.getElementById("out");
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xffffff);

      const renderer = new THREE.WebGLRenderer({
        canvas: glCanvas,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true
      });
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const camera = new THREE.PerspectiveCamera(
        32,
        window.innerWidth / window.innerHeight,
        0.01,
        1000
      );
      const direction = new THREE.Vector3(${direction[0]}, ${direction[1]}, ${direction[2]}).normalize();

      scene.add(new THREE.AmbientLight(0xffffff, 1.25));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
      keyLight.position.set(2.5, 3, 4);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.65);
      fillLight.position.set(-3, 1.5, -2);
      scene.add(fillLight);

      function centerRenderedImage() {
        const width = glCanvas.width;
        const height = glCanvas.height;
        const scanCanvas = document.createElement("canvas");
        scanCanvas.width = width;
        scanCanvas.height = height;
        const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
        if (!scanCtx) return;
        scanCtx.drawImage(glCanvas, 0, 0);

        const pixels = scanCtx.getImageData(0, 0, width, height).data;
        const bgThreshold = 245;
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            if (r > bgThreshold && g > bgThreshold && b > bgThreshold) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }

        outCanvas.width = width;
        outCanvas.height = height;
        const outCtx = outCanvas.getContext("2d");
        if (!outCtx) return;
        outCtx.fillStyle = "#ffffff";
        outCtx.fillRect(0, 0, width, height);

        if (maxX < minX || maxY < minY) {
          outCtx.drawImage(glCanvas, 0, 0);
        } else {
          const objectCenterX = (minX + maxX) / 2;
          const objectCenterY = (minY + maxY) / 2;
          const targetCenterX = (width - 1) / 2;
          const targetCenterY = (height - 1) / 2;
          const dx = Math.round(targetCenterX - objectCenterX);
          const dy = Math.round(targetCenterY - objectCenterY);
          outCtx.drawImage(glCanvas, dx, dy);
        }

        glCanvas.style.display = "none";
        outCanvas.style.display = "block";
      }

      const loader = new GLTFLoader();
      loader.load(${JSON.stringify(glbUrl)}, (gltf) => {
        const model = gltf.scene;
        scene.add(model);

        // Center the model by bounds before computing camera distance.
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        model.position.sub(center);

        const radius = Math.max(size.length() * 0.5, 0.01);
        const fovRad = THREE.MathUtils.degToRad(camera.fov);
        const fitOffset = 1.25;
        const distance = (radius / Math.sin(fovRad / 2)) * fitOffset;

        camera.position.copy(direction.multiplyScalar(distance));
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();

        renderer.render(scene, camera);
        centerRenderedImage();
        document.body.dataset.ready = "1";
      });
      loader.manager.onError = () => {
        document.body.dataset.error = "1";
      };
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
  if (!Object.hasOwn(CAMERA_DIRECTION_BY_VIEW, options.view)) {
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
