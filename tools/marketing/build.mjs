// Renders the marketing images from one template, with the same palette, lockup and cube as
// tools/social/build.mjs and real owner-console screenshots from images/screens/.
//
//   node tools/marketing/build.mjs
//
// Writes images/marketing/hero-showcase.webp (home page hero, 1140x560 at 2x) and
// images/marketing/card-*.png (1920x1080 feature cards for the sbox.game listing and READMEs).
// Needs Google Chrome; set CHROME=/path/to/chrome elsewhere. Text uses the site's system font
// stack, so render on macOS for the approved look.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '../..');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const logo = readFileSync(path.join(site, 'images/icon.svg'), 'utf8').replace(/<title>.*?<\/title>/, '');
const shot = (name) => `data:image/webp;base64,${readFileSync(path.join(site, `images/screens/console-${name}.webp`)).toString('base64')}`;
const check = '<svg class="ck" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd"/></svg>';
const arrow = '<svg class="ar" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clip-rule="evenodd"/></svg>';
const icons = readFileSync(path.join(site, 'images/icons.svg'), 'utf8');
const icon = (id, cls = 'ic') => {
  const symbol = icons.match(new RegExp(`<symbol id="${id}" viewBox="([^"]+)">([\\s\\S]*?)</symbol>`));
  return `<svg class="${cls}" viewBox="${symbol[1]}" fill="currentColor" aria-hidden="true">${symbol[2]}</svg>`;
};
// A framed screenshot showing one region: the 2560x1440 capture is drawn `width` px wide and
// shifted by (x, y), so a small frame can zoom in on readable detail.
const crop = ({ name, left, top, w, h, width, x, y, extra = '' }) =>
  `<div class="shot" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px;${extra}"><img src="${shot(name)}" alt="" style="position:absolute;max-width:none;width:${width}px;height:auto;left:${-x}px;top:${-y}px"></div>`;

// Colours are the dark-theme tokens from site.css.
const css = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:var(--w);height:var(--h);overflow:hidden}
body{background:#08090a;color:#f5f5f6;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.glow{position:absolute;inset:0;background:radial-gradient(900px 720px at var(--gx) var(--gy),rgb(112 224 0 / .15),transparent 70%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgb(112 224 0 / .06) 1px,transparent 1px),linear-gradient(90deg,rgb(112 224 0 / .06) 1px,transparent 1px);background-size:48px 48px;-webkit-mask-image:radial-gradient(860px 680px at var(--gx) var(--gy),#000,transparent 75%)}
.abs{position:absolute}
.lockup{display:inline-flex;align-items:center;gap:14px;height:58px;padding:0 24px;border:1px solid #222226;border-radius:999px;font-size:27px;font-weight:700;letter-spacing:-.02em;background:rgb(8 9 10 / .7)}
.lockup .plus{color:#66666f;font-weight:500}.lockup svg{width:32px;height:32px}
.eyebrow{display:flex;align-items:center;gap:14px;font:700 22px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.08em;color:#70e000;text-transform:uppercase}
.eyebrow svg{width:34px;height:34px}
h1{font-size:84px;line-height:1.02;letter-spacing:-.045em;font-weight:800}
h1 span{display:block;color:#70e000}
.lead{font-size:29px;line-height:1.42;color:#9b9ba3}
.lead b{color:#f5f5f6;font-weight:650}
.pills{display:flex;flex-wrap:wrap;gap:12px}
.pill{display:inline-flex;align-items:center;gap:10px;height:48px;padding:0 20px;border-radius:999px;background:#17171a;border:1px solid #222226;color:#e4e4e7;font-size:21px;font-weight:600}
.ck{width:24px;height:24px;color:#70e000;flex:none}
.ar{width:30px;height:30px;color:#70e000;flex:none}
.foot{font-size:22px;color:#66666f}.foot b{color:#9b9ba3;font-weight:650}
.panel{border:1px solid #26262b;border-radius:18px;background:#0e0f11;overflow:hidden;box-shadow:0 24px 70px rgb(0 0 0 / .55)}
.panel-h{display:flex;align-items:center;gap:10px;height:52px;padding:0 22px;border-bottom:1px solid #1c1c20;font:600 18px ui-monospace,"SF Mono",Menlo,monospace;color:#9b9ba3}
.panel-h .dot{width:10px;height:10px;border-radius:50%;background:#70e000;box-shadow:0 0 12px rgb(112 224 0 / .6)}
pre{font:20px/1.55 ui-monospace,"SF Mono",Menlo,monospace;color:#d4d4d8;padding:20px 24px;white-space:pre}
.k{color:#93c5fd}.n{color:#fbbf24}.s{color:#a3e635}.c{color:#66666f}.t{color:#c4b5fd}
.shot{position:absolute;border-radius:16px;overflow:hidden;background:#0a0a0b;box-shadow:0 34px 90px rgb(0 0 0 / .65),0 0 0 1px #2c2c31}
.shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:left top}
.chip{position:absolute;display:inline-flex;align-items:center;gap:14px;height:58px;padding:0 20px;border:1px solid #2c2c31;border-radius:14px;background:#0e0f11;font:22px ui-monospace,"SF Mono",Menlo,monospace;color:#d4d4d8;box-shadow:0 18px 44px rgb(0 0 0 / .6);white-space:nowrap}
.code{padding:4px 11px;border-radius:8px;font-weight:700;font-size:19px}
.ok{background:rgb(74 222 128 / .14);color:#4ade80}.err{background:rgb(248 113 113 / .14);color:#f87171}.inf{background:rgb(112 224 0 / .14);color:#70e000}
.list{display:grid;gap:18px;font-size:25px;line-height:1.35;color:#d4d4d8}
.list li{display:flex;gap:14px;align-items:flex-start;list-style:none}.list li .ck{margin-top:3px}
.list b{color:#f5f5f6;font-weight:650}
.log{display:grid}
.log div{display:grid;grid-template-columns:76px 250px 1fr;align-items:center;gap:14px;height:62px;padding:0 22px;border-bottom:1px solid #18181b;font:21px ui-monospace,"SF Mono",Menlo,monospace;color:#d4d4d8}
.log div:last-child{border-bottom:0}
.log .code{justify-self:start}.log em{font-style:normal;color:#8f8f98;font-size:19px}
.tile{border:1px solid #222226;border-radius:18px;background:#0e0f11;padding:30px 30px 28px;display:flex;flex-direction:column;gap:14px}
.tile h3{font-size:31px;letter-spacing:-.02em}
.tile .ic{width:48px;height:48px;padding:11px;border-radius:12px;background:rgb(112 224 0 / .12);color:#70e000}
.tile p{font-size:22px;line-height:1.45;color:#9b9ba3}
.tile .key{margin-top:auto;display:inline-flex;align-self:flex-start;align-items:center;gap:10px;height:42px;padding:0 16px;border-radius:999px;background:#17171a;font-size:19px;font-weight:650;color:#e4e4e7}
.tile .key i{width:10px;height:10px;border-radius:50%;background:#70e000}
.lane{display:grid;grid-template-columns:330px 46px 1fr;align-items:center;gap:18px}
.box{border:1px solid #26262b;border-radius:16px;background:#0e0f11;padding:20px 24px}
.box b{display:block;font-size:26px;letter-spacing:-.01em}
.box small{display:block;margin-top:6px;font-size:20px;color:#9b9ba3}
.box.live{border-color:rgb(112 224 0 / .55);box-shadow:0 0 0 1px rgb(112 224 0 / .25),0 20px 50px rgb(112 224 0 / .08)}
.box code{font:20px ui-monospace,"SF Mono",Menlo,monospace;color:#d4d4d8}
.tag{display:inline-flex;align-items:center;height:30px;padding:0 12px;border-radius:999px;font-size:17px;font-weight:700;margin-left:10px;vertical-align:middle}
.tag.live{background:rgb(112 224 0 / .16);color:#70e000}.tag.old{background:#1f1f23;color:#9b9ba3}
`;

const page = ({ width, height, scale = 1, gx = '78%', gy = '30%', body }) => ({
  width, height, scale,
  html: `<!doctype html><html><head><meta charset="utf-8"><style>:root{--w:${width}px;--h:${height}px;--gx:${gx};--gy:${gy}}${css}</style></head>
<body><div class="glow"></div><div class="grid"></div>${body}</body></html>`,
});

const lockup = `<div class="lockup">s&amp;box<span class="plus">+</span>${logo}Network Storage</div>`;
const foot = (x, y) => `<p class="foot abs" style="left:${x}px;top:${y}px"><b>sboxns.com</b> · free and open source · self-hosted</p>`;

const IMAGES = [
  { file: 'images/marketing/hero-showcase.webp', ...page({ width: 1140, height: 560, scale: 2, gx: '50%', gy: '45%', body: `
<div class="shot" style="left:0;top:70px;width:700px;height:394px"><img src="${shot('endpoint-pipeline')}" alt=""></div>
${crop({ name: 'game-values', left: 724, top: 30, w: 416, h: 214, width: 1000, x: 248, y: 136 })}
${crop({ name: 'endpoint-test', left: 724, top: 276, w: 416, h: 214, width: 1000, x: 196, y: 62 })}
<div class="chip" style="left:770px;top:228px;height:44px;font-size:16px;padding:0 14px;gap:10px"><span class="code inf" style="font-size:14px">values</span>combat · weapons · items</div>
<div class="chip" style="left:886px;top:470px;height:44px;font-size:16px;padding:0 14px;gap:10px"><span class="code err" style="font-size:14px">400</span>TOO_MANY_HITS</div>
<div class="chip" style="left:24px;top:440px;height:44px;font-size:16px;padding:0 14px;gap:10px"><span class="code inf" style="font-size:14px">rev 42</span>live · older builds pinned</div>
<div class="chip" style="left:420px;top:496px;height:44px;font-size:16px;padding:0 14px;gap:10px"><span class="code ok" style="font-size:14px">200</span>finish-combat · +45 xp</div>` }) },

  { file: 'images/marketing/card-hero.png', ...page({ width: 1920, height: 1080, gx: '74%', gy: '40%', body: `
<div class="abs" style="left:96px;top:104px;width:790px">${lockup}
<h1 style="margin-top:64px;font-size:94px">Any host.<span>Every transaction validated.</span></h1>
<p class="lead" style="margin-top:34px">The open-source game backend for <b>s&amp;box</b>. Saves, purchases, rewards and combat results are checked on <b>your</b> server before anything is saved.</p>
<div class="pills" style="margin-top:44px"><span class="pill">${check}Game values</span><span class="pill">${check}Server-side rules</span><span class="pill">${check}Versioned builds</span></div></div>
${foot(96, 990)}
<div class="shot" style="left:960px;top:140px;width:1160px;height:653px"><img src="${shot('endpoint-test')}" alt=""></div>
<div class="panel abs" style="left:880px;top:640px;width:560px"><div class="panel-h"><span class="dot"></span>game values</div><pre>- <span class="k">id</span>: combat
  <span class="k">type</span>: group
  <span class="k">entries</span>:
    <span class="k">zombie_hp_per_level</span>: <span class="n">20</span>
    <span class="k">max_clock_skew_ms</span>: <span class="n">2000</span></pre></div>
<div class="chip" style="left:1490px;top:836px"><span class="code err">400</span>TOO_MANY_HITS</div>
<div class="chip" style="left:1490px;top:914px"><span class="code ok">200</span>finish-combat · +45 xp</div>
<div class="chip" style="left:1300px;top:76px"><span class="code inf">values</span>combat · weapons · items</div>` }) },

  { file: 'images/marketing/card-game-values.png', ...page({ width: 1920, height: 1080, gx: '50%', gy: '62%', body: `
<div class="abs" style="left:96px;top:92px;width:1500px"><p class="eyebrow">${logo}Game values</p>
<h1 style="margin-top:30px">Define it once. <span style="display:inline">Game and server agree.</span></h1>
<p class="lead" style="margin-top:26px;max-width:1420px">Weapons, items, prices and tuning live in game values. Your game loads them in <b>one call</b> and predicts locally; your endpoints check every claim against <b>the same numbers</b> on the server.</p></div>
<div class="panel abs" style="left:96px;top:424px;width:520px;height:440px"><div class="panel-h"><span class="dot"></span>game values</div><pre><span class="k">items</span>:
  - <span class="k">id</span>: combat
    <span class="k">type</span>: group
    <span class="k">entries</span>:
      <span class="k">zombie_hp_per_level</span>: <span class="n">20</span>
      <span class="k">max_clock_skew_ms</span>: <span class="n">2000</span>
  - <span class="k">id</span>: weapons
    <span class="k">type</span>: table
    <span class="k">rows</span>:
      - <span class="k">weapon_id</span>: pistol
        <span class="k">damage</span>: <span class="n">15</span>  <span class="c"># …</span></pre></div>
<div class="panel abs" style="left:644px;top:424px;width:600px;height:440px"><div class="panel-h"><span class="dot"></span>in your game · C#</div><pre><span class="t">var</span> gv = (<span class="t">await</span> NetworkStorage
    .GetGameValues()).Value;
<span class="t">var</span> combat = gv.GetProperty( <span class="s">"groups"</span> )
    .GetProperty( <span class="s">"combat"</span> )
    .GetProperty( <span class="s">"values"</span> );

<span class="c">// Show the zombie's health instantly</span>
<span class="t">int</span> hp = combat.Int( <span class="s">"zombie_hp_per_level"</span> )
    * zombieLevel;</pre></div>
<div class="panel abs" style="left:1272px;top:424px;width:552px;height:440px"><div class="panel-h"><span class="dot"></span>on your server · endpoint</div><pre>- <span class="k">id</span>: zombie
  <span class="k">type</span>: compute
  <span class="k">values</span>:
    <span class="k">hp</span>: <span class="s">"{{values.combat</span>
<span class="s">      .zombie_hp_per_level}}</span>
<span class="s">      * {{input.zombie_level}}"</span>
- <span class="k">id</span>: zombie_dead
  <span class="k">type</span>: condition
  <span class="c"># damage ≥ hp, or reject</span></pre></div>
<ul class="list abs" style="left:96px;top:910px;width:1728px;display:grid;grid-template-columns:repeat(3,1fr);gap:28px">
<li>${check}<span><b>One request</b> loads every table. No ping per lookup.</span></li>
<li>${check}<span><b>Sync Tool</b> pushes and pulls them with your project.</span></li>
<li>${check}<span><b>Change a value live</b>, no game update needed.</span></li></ul>` }) },

  { file: 'images/marketing/card-anti-exploit.png', ...page({ width: 1920, height: 1080, gx: '72%', gy: '45%', body: `
<div class="abs" style="left:96px;top:92px;width:820px"><p class="eyebrow">${logo}Server-side rules</p>
<h1 style="margin-top:30px">Modded client?<span>Rejected, not saved.</span></h1>
<p class="lead" style="margin-top:28px">Endpoints recompute every claim from game values and the server clock. Lightweight authority for an RPG, without simulating it on a dedicated server.</p>
<ul class="list" style="margin-top:46px">
<li>${check}<span>Damage must reach the zombie's <b>HP from game values</b></span></li>
<li>${check}<span>Hits must fit the weapon's fire rate since a <b>server-stamped start</b></span></li>
<li>${check}<span>The client clock must be within <b>2 s of the server</b></span></li>
<li>${check}<span><b>One reward per fight</b>; a replay gets NO_COMBAT</span></li></ul></div>
<div class="panel abs" style="left:1000px;top:120px;width:824px"><div class="panel-h"><span class="dot"></span>finish-combat · responses from a real run</div>
<div class="log">
<div><span class="code ok">200</span>start-combat<em>zombie_hp 60 · server time stamped</em></div>
<div><span class="code err">400</span>TOO_MANY_HITS<em>faster than the weapon can fire</em></div>
<div><span class="code err">400</span>ZOMBIE_ALIVE<em>not enough damage</em></div>
<div><span class="code err">400</span>CLOCK_SKEW<em>client clock 60 s off</em></div>
<div><span class="code ok">200</span>finish-combat<em>+45 xp saved</em></div>
<div><span class="code err">409</span>NO_COMBAT<em>same request replayed</em></div></div></div>
${crop({ name: 'endpoint-pipeline', left: 1000, top: 590, w: 824, h: 350, width: 1800, x: 360, y: 176 })}
<p class="foot abs" style="left:96px;top:990px">Checks bound what a client can claim; they cannot prove a hit landed. Endpoint YAML on <b>sboxns.com</b>.</p>` }) },

  { file: 'images/marketing/card-versions.png', ...page({ width: 1920, height: 1080, gx: '66%', gy: '58%', body: `
<div class="abs" style="left:96px;top:92px;width:1600px"><p class="eyebrow">${logo}Revisions</p>
<h1 style="margin-top:30px">Ship updates. <span style="display:inline">Old builds keep working.</span></h1>
<p class="lead" style="margin-top:26px;max-width:1480px">Publishing a build snapshots its endpoints, collections and game values. Players still on the previous build keep their revision while they update, so <b>nobody gets an item their build cannot load</b>.</p></div>
<div class="abs" style="left:96px;top:440px;width:1180px;display:grid;gap:26px">
<div class="lane"><div class="box"><b>Build r41<span class="tag old">updating</span></b><small>players on yesterday's build</small></div>${arrow}<div class="box"><b>Revision 41 snapshot</b><small><code>pistol damage 15 · 4 items</code></small></div></div>
<div class="lane"><div class="box"><b>Build r42<span class="tag live">new</span></b><small>just published to sbox.game</small></div>${arrow}<div class="box live"><b>Revision 42 · live</b><small><code>pistol damage 18 · 5 items + flare_gun</code></small></div></div></div>
<div class="abs" style="left:1330px;top:440px;width:494px;display:grid;gap:22px">
<div class="tile" style="padding:26px"><h3>Push Staged</h3><p>Changes ship with your next published build. Older builds keep theirs.</p></div>
<div class="tile" style="padding:26px"><h3>Push Live</h3><p>Keep it simple: every build gets the change right now.</p></div></div>
<div class="shot" style="left:96px;top:760px;width:1180px;height:220px"><img src="${shot('version-history')}" alt="" style="object-position:left 36%"></div>
<p class="foot abs" style="left:1330px;top:900px;width:494px;line-height:1.4">Older revisions stay inside their support window. Player records are always shared live data.</p>` }) },

  { file: 'images/marketing/card-any-host.png', ...page({ width: 1920, height: 1080, gx: '50%', gy: '70%', body: `
<div class="abs" style="left:96px;top:92px;width:1700px"><p class="eyebrow">${logo}Any host</p>
<h1 style="margin-top:30px">Player-hosted, P2P or dedicated.<span>One backend owns the rules.</span></h1>
<p class="lead" style="margin-top:26px;max-width:1400px">Game sessions stay thin. Currency, XP, items and scores only change through endpoints on <b>your</b> Network Storage server, whoever hosts the match.</p></div>
<div class="abs" style="left:96px;top:500px;width:1728px;height:360px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
<div class="tile">${icon('i-users')}<h3>Player-hosted</h3><p>A player runs the listen server with the public key. It can call public endpoints but cannot rewrite anyone's data. Free to run, safe by default.</p><span class="key"><i></i>Public key</span></div>
<div class="tile">${icon('i-server')}<h3>Dedicated</h3><p>Your box holds a secret key for dedicated-only endpoints: tournaments, seasons and anything worth protecting.</p><span class="key"><i></i>Secret key</span></div>
<div class="tile">${icon('i-arrows')}<h3>Hybrid</h3><p>Players host day-to-day sessions while your server runs special modes. One project serves both.</p><span class="key"><i></i>Both</span></div></div>
${foot(96, 990)}` }) },

  { file: 'images/marketing/card-self-hosted.png', ...page({ width: 1920, height: 1080, gx: '76%', gy: '42%', body: `
<div class="abs" style="left:96px;top:92px;width:860px"><p class="eyebrow">${logo}Self-hosted</p>
<h1 style="margin-top:30px">One command.<span>Your server, your data.</span></h1>
<p class="lead" style="margin-top:28px">One binary with SQLite or PostgreSQL, a free HTTPS name and a full owner dashboard. Open source, no signup, no subscription.</p>
<div class="panel" style="margin-top:44px"><div class="panel-h"><span class="dot"></span>Linux VPS or Mac</div><pre style="font-size:19px"><span class="t">curl</span> -fsSL https://github.com/sbox-cool/\\
  sbox-network-storage-server/releases/latest/\\
  download/install.sh \\
  | sudo env SBOX_NS_PROJECT=<span class="s">"My Game"</span> \\
    SBOX_NS_TUNNEL=<span class="n">1</span> sh</pre></div>
<div class="pills" style="margin-top:34px"><span class="pill">${check}SQLite or PostgreSQL</span><span class="pill">${check}Free HTTPS name</span><span class="pill">${check}MCP for coding agents</span><span class="pill">${check}AGPL-3.0</span></div></div>
${foot(96, 1000)}
<div class="shot" style="left:1030px;top:140px;width:1100px;height:619px"><img src="${shot('player-records')}" alt=""></div>
<div class="shot" style="left:1090px;top:560px;width:640px;height:360px"><img src="${shot('server-monitoring')}" alt=""></div>` }) },
];

const tmp = mkdtempSync(path.join(os.tmpdir(), 'marketing-'));
try {
  for (const image of IMAGES) {
    const file = path.join(tmp, 'card.html');
    writeFileSync(file, image.html);
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${image.scale}`,
      `--window-size=${image.width},${image.height}`, `--screenshot=${path.join(site, image.file)}`, `file://${file}`], { stdio: 'ignore' });
    console.log(`${image.file} ${image.width * image.scale}x${image.height * image.scale}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
