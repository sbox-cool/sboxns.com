"""Generates the static sboxns.com redesign mockups."""
import json, os, sys

OUT = sys.argv[1]
ICONS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons.json")))


def i(name, cls="i"):
    ic = ICONS[name]
    return f'<svg class="{cls}" viewBox="{ic["viewBox"]}" fill="currentColor" aria-hidden="true">{ic["body"]}</svg>'


def cmd(body):
    return f'<div class="cmd"><pre>{body}</pre><button class="icon-btn" title="Copy">{i("copy")}</button></div>'


def nav(on=""):
    links = [("Demo", ""), ("Install", "install"), ("Docs", ""), ("Self-hosting", ""), ("GitHub", "")]
    l = "".join(f'<a class="{"on" if k and k == on else ""}" href="#">{n}</a>' for n, k in links)
    return f'''<header class="nav"><div class="wrap"><a class="brand" href="#"><img src="brand.svg" alt="">sboxns.com</a><nav class="links">{l}</nav><span class="spacer"></span>
<button class="icon-btn" title="Theme">{i("theme")}</button><a class="btn sm" href="#">{i("play")}Live demo</a><button class="icon-btn menu-btn" title="Menu">{i("menu")}</button></div></header>'''


FOOT = f'''<footer class="foot"><div class="wrap"><div><a class="brand" href="#"><img src="brand.svg" alt="">sboxns.com</a><p>AGPL-3.0, pre-1.0. Keep backups and read release notes before updating.</p></div>
<div><h4>Product</h4><a href="#">Live demo</a><a href="#">Documentation</a><a href="#">GitHub</a></div>
<div><h4>Self-hosting</h4><a href="#">Install guide</a><a href="#">Hosted names</a><a href="#">MCP and agents</a></div>
<div><h4>Trust</h4><a href="#">Data boundaries</a><a href="#">Privacy</a><a href="#">Acceptable use</a></div></div></footer>'''

INSTALL = ('<span class="p">$ </span>curl -fsSL https://github.com/sbox-cool/sbox-network-storage-server/releases/latest/download/install.sh \\\n'
           '  | sudo env <span class="v">SBOX_NS_PROJECT</span>=<span class="s">"My Game"</span> <span class="v">SBOX_NS_DNS</span>=1 \\\n'
           '      <span class="v">SBOX_NS_ACME_EMAIL</span>=<span class="s">"you@example.com"</span> <span class="v">SBOX_NS_ACCEPT_LETSENCRYPT_TERMS</span>=1 sh')

home = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>sboxns.com</title><link rel="stylesheet" href="site.css"></head><body>
{nav()}
<main class="wrap">
<section class="hero"><div><h1>Your game. Any host.<br>Your backend.</h1>
<p>Open-source backend for s&amp;box. Your server owns the saves, purchases and reward rules.</p>
<div class="actions"><a class="btn primary" href="#">{i("play")}Open live demo</a><a class="btn" href="#">{i("github")}Source</a></div>
<div class="facts"><span>{i("check-circle")}No signup</span><span>{i("check-circle")}No subscription</span><span>{i("check-circle")}SQLite or PostgreSQL</span></div></div>
<div class="card install"><div class="card-h"><strong>Install</strong><span class="spacer"></span><span class="seg"><span class="on">Public IP</span><span>No open ports</span><span>Windows</span><span>Own domain</span></span></div>
{cmd(INSTALL)}
<div class="card-f"><span>{i("shield")}Verifies SHA256SUMS</span><span>{i("lock")}Free HTTPS name</span><a href="#">Full guide{i("chev")}</a></div></div></section>

<section class="section"><div class="sec-h"><h2>After install</h2><a href="#">Install guide{i("chev")}</a></div>
<div class="next">
<div class="card"><h3><b>1</b>Sign in</h3><p>Single-use link to <code>/login</code>.</p>{cmd('<span class="p">$ </span>sudo sbox-ns admin login-link')}</div>
<div class="card"><h3><b>2</b>Connect the game</h3><p>Public key only in game code.</p>{cmd('NetworkStorage.Configure( <span class="s">"ID"</span>, <span class="s">"KEY"</span>, <span class="s">"https://NAME"</span> );')}</div>
<div class="card"><h3><b>3</b>Check health</h3><p>Database, ports, certificate, DNS.</p>{cmd('<span class="p">$ </span>sudo sbox-ns doctor')}</div></div></section>

<section class="section"><div class="sec-h"><h2>Live demo</h2><a href="#">demo.sboxns.com{i("ext")}</a></div>
<div class="shots"><a class="shot" href="#"><img src="thumb-project.png" alt=""><span>Project overview</span></a><a class="shot" href="#"><img src="thumb-collection.png" alt=""><span>Collection records</span></a><a class="shot" href="#"><img src="thumb-record.png" alt=""><span>Record detail</span></a></div></section>

<section class="section"><div class="feat">
<div><b>Player persistence</b><span>Per-player saves, world records, queries, leaderboards.</span></div>
<div><b>Server-side rules</b><span>Endpoints check balances and cap rewards.</span></div>
<div><b>Agent-ready</b><span>CLI, JSON output, allowlisted MCP server.</span></div>
<div><b>Portable</b><span>Export config and data. Move hosts anytime.</span></div></div></section>
</main>{FOOT}</body></html>'''

with open(os.path.join(OUT, "home.html"), "w") as f:
    f.write(home)


def install_page(modal=False):
    m = ""
    if modal:
        m = f'''<div class="scrim"></div><div class="modal"><div class="mh"><h2>Does my server depend on sboxns.com?</h2><span class="spacer"></span><button class="icon-btn">{i("x")}</button></div>
<div class="mb"><p>Only to create your name and to update it when your IP changes.</p><p><strong>Public IP:</strong> players connect to you directly; Bunny DNS answers the lookup.</p><p><strong>Tunnel:</strong> Cloudflare carries the traffic to you.</p><p>If sboxcool.com goes down, your existing name keeps working.</p></div></div>'''
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Install</title><link rel="stylesheet" href="site.css"></head><body>
{nav("install")}
<main class="wrap doc"><nav class="steps-nav"><a class="on" href="#"><b>1</b>Install</a><a href="#"><b>2</b>Credentials</a><a href="#"><b>3</b>Dashboard</a><a href="#"><b>4</b>Editor</a><hr><a class="x" href="#">Hosted names</a><a class="x" href="#">Own domain</a><a class="x" href="#">Docker and PostgreSQL</a></nav>
<div><div class="crumbs"><a href="#">Home</a><span>/</span><span class="here">Install</span></div><h1>Install</h1><p class="lead">Linux VPS with sudo. About two minutes.</p>
<section class="card step"><div class="card-h"><b>1</b><h2>Install the server</h2><div class="tools"><span class="seg"><span class="on">Public IP</span><span>No open ports</span><span>Windows</span></span></div></div>
<div class="body"><p>Name like <code>NAME.n1.sboxns.com</code>. Ports 443 and the HTTP check port must be reachable.</p>{cmd(INSTALL)}
<div class="chips"><a class="chip" href="#">{i("shield")}Checksum verification</a><a class="chip" href="#">{i("info")}Let's Encrypt terms</a><a class="chip" href="#">{i("info")}Depends on sboxns.com?</a><a class="chip" href="#">{i("ext")}Read install.sh</a></div></div></section>
<section class="card step"><div class="card-h"><b>2</b><h2>Keep the printed credentials</h2></div>
<div class="body"><p>Project ID, public key, secret key and HTTPS address. Print them again any time:</p>{cmd('<span class="p">$ </span>sudo sbox-ns quickstart <span class="s">"My Game"</span>')}</div></section>
<section class="card step"><div class="card-h"><b>3</b><h2>Open the dashboard</h2></div>
<div class="body">{cmd('<span class="p">$ </span>sudo sbox-ns admin login-link')}</div></section>
<section class="card step"><div class="card-h"><b>4</b><h2>Connect the s&amp;box editor</h2><div class="tools"><a class="chip" href="#">{i("ext")}Library 1.0.309133+</a></div></div>
<div class="body"><p>Editor &gt; Network Storage &gt; Setup, then Sync Tool.</p>{cmd('NetworkStorage.Configure( <span class="s">"YOUR_PROJECT_ID"</span>, <span class="s">"sbox_ns_YOUR_PUBLIC_KEY"</span>, <span class="s">"https://YOUR_HOSTNAME"</span> );')}</div></section>
</div></main>{m}</body></html>'''


with open(os.path.join(OUT, "install.html"), "w") as f:
    f.write(install_page())
with open(os.path.join(OUT, "install-modal.html"), "w") as f:
    f.write(install_page(modal=True))
for base in ("home", "install", "install-modal"):
    src = open(os.path.join(OUT, base + ".html")).read()
    out = src.replace('<html lang="en">', '<html lang="en" data-theme="light">', 1).replace(i("theme"), i("sun"))
    for t in ("project", "collection", "record"):
        out = out.replace(f"thumb-{t}.png", f"thumb-{t}-light.png")
    open(os.path.join(OUT, base + "-light.html"), "w").write(out)
print("ok")
