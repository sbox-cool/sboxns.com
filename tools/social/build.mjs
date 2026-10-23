// Renders the link-preview cards from one template so every surface shares the canonical logo and palette.
//
//   node tools/social/build.mjs
//
// Writes images/social-card.png (og:image / twitter:image, 1200x630) and tools/social/github-*.png
// (GitHub repository social previews, 1280x640; upload under Settings > Social preview).
// Needs Google Chrome; set CHROME=/path/to/chrome elsewhere. Text uses the site's system font stack,
// so render on macOS for the approved look.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '../..');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const logo = readFileSync(path.join(site, 'images/icon.svg'), 'utf8').replace(/<title>.*?<\/title>/, '');

const TAGLINE = ['Any host.', 'Your server runs the rules.'];
const CHECKS = [['200', 'ok', 'purchase-item'], ['409', 'err', 'ALREADY_CLAIMED'], ['403', 'err', 'ENDPOINT_ONLY']];

const CARDS = [
  { file: 'images/social-card.png', width: 1200, height: 630,
    lead: 'Open-source backend for player-hosted and dedicated s&amp;box games.',
    foot: '<b>sboxns.com</b> · free to self-host' },
  { file: 'tools/social/github-sboxns.com.png', width: 1280, height: 640,
    lead: 'Open-source backend for player-hosted and dedicated s&amp;box games.',
    foot: '<b>sboxns.com</b> · setup, docs and live demo' },
  { file: 'tools/social/github-sbox-network-storage-server.png', width: 1280, height: 640,
    lead: 'The self-hosted server. SQLite or PostgreSQL, one binary, free HTTPS name.',
    foot: '<b>sbox-network-storage-server</b> · sboxns.com' },
  { file: 'tools/social/github-sbox-network-storage.png', width: 1280, height: 640,
    lead: 'Game library and editor tools that connect your s&amp;box game to your backend.',
    foot: '<b>sbox-network-storage</b> · sboxns.com' },
];

// Colours are the dark-theme tokens from site.css; the cube is images/icon.svg verbatim.
const html = ({ width, height, lead, foot }) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{width:${width}px;height:${height}px;overflow:hidden}
body{background:#08090a;color:#f5f5f6;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.glow{position:absolute;inset:0;background:radial-gradient(560px 460px at 78% 32%,rgb(112 224 0 / .16),transparent 70%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgb(112 224 0 / .07) 1px,transparent 1px),linear-gradient(90deg,rgb(112 224 0 / .07) 1px,transparent 1px);background-size:40px 40px;-webkit-mask-image:radial-gradient(480px 420px at 78% 32%,#000,transparent 75%)}
.copy{position:absolute;left:72px;top:64px;width:${width * 0.56}px}
.lockup{display:inline-flex;align-items:center;gap:16px;height:62px;padding:0 22px;border:1px solid #222226;border-radius:999px;font-size:29px;font-weight:700;letter-spacing:-.02em}
.lockup .plus{color:#66666f;font-weight:500}.lockup svg{width:34px;height:34px}
h1{margin-top:${height * 0.07}px;font-size:${Math.round(width * 0.058)}px;line-height:1.02;letter-spacing:-.045em;font-weight:800}
h1 span{display:block;color:#70e000}
.lead{margin-top:28px;font-size:27px;line-height:1.35;color:#9b9ba3;max-width:600px}
.foot{margin-top:14px;font-size:23px;color:#9b9ba3}.foot b{color:#f5f5f6;font-weight:700}
.cube{position:absolute;right:${width * 0.13}px;top:${height * 0.15}px;width:${height * 0.38}px;height:${height * 0.38}px;filter:drop-shadow(0 18px 40px rgb(112 224 0 / .22))}
.cube svg{width:100%;height:100%}
.checks{position:absolute;right:72px;bottom:72px;width:${width * 0.35}px;display:grid;gap:14px}
.check{display:flex;align-items:center;gap:14px;height:52px;padding:0 16px;border:1px solid #222226;border-radius:12px;background:#0e0f11;font:22px ui-monospace,"SF Mono",Menlo,monospace;color:#d4d4d8}
.code{padding:3px 9px;border-radius:7px;font-weight:600;font-size:19px}
.ok{background:rgb(74 222 128 / .14);color:#4ade80}.err{background:rgb(248 113 113 / .14);color:#f87171}
</style></head><body><div class="glow"></div><div class="grid"></div>
<div class="copy"><div class="lockup">s&amp;box<span class="plus">+</span>${logo}Network Storage</div>
<h1>${TAGLINE[0]}<span>${TAGLINE[1]}</span></h1><p class="lead">${lead}</p><p class="foot">${foot}</p></div>
<div class="cube">${logo}</div>
<div class="checks">${CHECKS.map(([code, kind, name]) => `<div class="check"><span class="code ${kind}">${code}</span>${name}</div>`).join('')}</div>
</body></html>`;

const tmp = mkdtempSync(path.join(os.tmpdir(), 'social-'));
try {
  for (const card of CARDS) {
    const page = path.join(tmp, 'card.html');
    writeFileSync(page, html(card));
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${card.width},${card.height}`, `--screenshot=${path.join(site, card.file)}`, `file://${page}`], { stdio: 'ignore' });
    console.log(`${card.file} ${card.width}x${card.height}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
