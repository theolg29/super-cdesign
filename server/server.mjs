// Super CDesign — serveur local de preview mobile.
//
// Surveille un dossier (par défaut super-cdesign-exports/, à la racine du
// projet) où l'on dépose les exports
// HTML de Claude Design (« Export this artboard » → HTML (.zip)), et les sert
// sur le Wi-Fi pour les ouvrir sur un vrai téléphone.
//
//   super-cdesign-exports/Accueil · Desktop-html.zip  → un projet d'une page
//   super-cdesign-exports/page.html                   → un projet d'une page
//   super-cdesign-exports/MonSite/*.zip, *.html…      → un projet de plusieurs pages,
//                                                        réunies : les liens entre elles marchent
//
//   GET /                     accueil (téléphone) : projets et pages
//   GET /p/<projet>/<page>    le site (viewport mobile + rechargement auto injectés)
//   GET /api/qr               { url, svg, dir } : QR code de l'accueil (bouton de l'extension)
//   GET /api/state            version globale (rechargement de l'accueil)
//   GET /api/version/<projet> version d'un projet (rechargement des pages)

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const run = promisify(execFile);
const PORT = Number(process.env.PORT) || 4321;
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SERVER_DIR, '..');
// Dossier des exports, à la racine du projet (exclu de git : il contient des designs clients).
const WATCH_DIR = path.resolve(process.env.SUPERDESIGN_DIR || path.join(PROJECT_DIR, 'super-cdesign-exports'));
// Sites décompressés, reconstruits à chaque changement (exclu de git).
const CACHE = path.join(SERVER_DIR, '.cache');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

// --- Réseau ---------------------------------------------------------------------

// Adresse IPv4 du Mac sur le réseau local (celle que le téléphone peut joindre).
function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(utun|bridge|vmnet|docker|awdl|llw)/.test(name)) continue;
      candidates.push({ name, address: a.address });
    }
  }
  const pref = candidates.find((c) => c.name === 'en0') ||
    candidates.find((c) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(c.address)) ||
    candidates[0];
  return pref ? pref.address : '127.0.0.1';
}
const homeUrl = () => `http://${lanAddress()}:${PORT}/`;

// --- Projets --------------------------------------------------------------------

const slug = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'projet';
const cleanTitle = (name) => name.replace(/\.(zip|html?)$/i, '').replace(/-html$/i, '').trim();
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// slug → { slug, title, source, dir, pages: [{ file, title }], version, updatedAt }
const projects = new Map();
let globalVersion = 0;

const isSource = (name) => /\.(zip|html?)$/i.test(name) && !name.startsWith('.');

async function listSources() {
  let entries = [];
  try {
    entries = await fs.readdir(WATCH_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || (e.isFile() && isSource(e.name))))
    .map((e) => ({ name: e.name, path: path.join(WATCH_DIR, e.name), isDir: e.isDirectory() }));
}

// Infos d'un export Claude Design : « # Accueil · Desktop — design reference »
// et « open `Main.dc.html` ».
async function readmeInfo(dir) {
  try {
    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    const title = (/^#\s+(.+?)\s+[—-]+\s+design reference/m.exec(readme) || [])[1];
    const entry = (/open\s+`([^`]+\.html?)`/i.exec(readme) || /`([^`]+\.html?)`\s+[—-]+\s+the artboard/i.exec(readme) || [])[1];
    return { title, entry };
  } catch {
    return {};
  }
}

async function listHtml(dir) {
  const out = [];
  const walk = async (d, depth) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 2 && !/^(vendor|assets|node_modules|__MACOSX)$/.test(e.name)) await walk(p, depth + 1);
      else if (e.isFile() && /\.html?$/i.test(e.name)) out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  await walk(dir, 0);
  return out;
}

// Construit le site d'un projet dans le cache : zips décompressés (du plus
// ancien au plus récent) puis fichiers libres copiés par-dessus.
async function buildProject(src) {
  const title = src.isDir ? src.name : cleanTitle(src.name);
  const key = slug(title);
  const out = path.join(CACHE, key);
  const tmp = out + '.build';
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });

  const files = src.isDir
    ? (await fs.readdir(src.path, { withFileTypes: true }))
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: path.join(src.path, e.name), isDir: e.isDirectory() }))
    : [{ name: src.name, path: src.path, isDir: false }];

  const titles = {}; // page → titre (depuis le README de chaque export)
  const zips = [];
  for (const f of files) if (!f.isDir && /\.zip$/i.test(f.name)) zips.push({ ...f, mtime: (await fs.stat(f.path)).mtimeMs });
  zips.sort((a, b) => a.mtime - b.mtime);
  for (const z of zips) {
    const part = tmp + '.part';
    await fs.rm(part, { recursive: true, force: true });
    // (unzip ignore d'office les chemins en « ../ » d'un zip malveillant.)
    await run('unzip', ['-q', '-o', z.path, '-d', part]);
    const info = await readmeInfo(part);
    if (info.entry) titles[info.entry] = info.title || cleanTitle(z.name);
    await fs.rm(path.join(part, 'README.md'), { force: true });
    await fs.cp(part, tmp, { recursive: true, force: true });
    await fs.rm(part, { recursive: true, force: true });
  }
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) continue;
    await fs.cp(f.path, path.join(tmp, f.name), { recursive: true, force: true });
  }

  // Pages = la frame de chaque export (nommée par son README), même si une
  // autre page l'importe (la Boutique importe Main), plus les fichiers HTML
  // qu'aucun autre n'importe comme composant (<dc-import name="Nav"> → Nav.dc.html).
  const html = await listHtml(tmp);
  const imported = new Set();
  for (const h of html) {
    const text = await fs.readFile(path.join(tmp, h), 'utf8').catch(() => '');
    for (const m of text.matchAll(/<dc-import[^>]*\bname=["']([^"']+)["']/gi)) imported.add(m[1] + '.dc.html');
  }
  const pages = [];
  for (const h of html) {
    if (!titles[h] && imported.has(path.basename(h))) continue;
    let t = titles[h];
    if (!t) {
      const text = await fs.readFile(path.join(tmp, h), 'utf8').catch(() => '');
      t = (/<title>([^<]+)<\/title>/i.exec(text) || [])[1] || h.replace(/\.dc\.html?$|\.html?$/i, '');
    }
    pages.push({ file: h, title: t.trim() });
  }
  pages.sort((a, b) => a.title.localeCompare(b.title, 'fr'));

  await fs.rm(out, { recursive: true, force: true });
  await fs.rename(tmp, out);
  const prev = projects.get(key);
  const p = { slug: key, title, source: src.path, dir: out, pages, version: (prev?.version || 0) + 1, updatedAt: Date.now() };
  projects.set(key, p);
  return p;
}

// --- Surveillance du dossier ------------------------------------------------------

let scanning = null;
let rescan = false;
const signatures = new Map(); // source → signature (noms, tailles, dates)

async function signature(src) {
  const items = src.isDir
    ? (await fs.readdir(src.path)).filter((n) => !n.startsWith('.')).map((n) => path.join(src.path, n))
    : [src.path];
  const parts = [];
  for (const it of items) {
    const st = await fs.stat(it).catch(() => null);
    if (st) parts.push(`${path.basename(it)}:${st.size}:${Math.round(st.mtimeMs)}`);
  }
  return parts.sort().join('|');
}

async function scan() {
  if (scanning) {
    rescan = true;
    return scanning;
  }
  scanning = (async () => {
    const sources = await listSources();
    const seen = new Set();
    let changed = false;
    for (const src of sources) {
      const key = slug(src.isDir ? src.name : cleanTitle(src.name));
      seen.add(key);
      const sig = await signature(src).catch(() => '');
      if (signatures.get(src.path) === sig && projects.has(key)) continue;
      try {
        const p = await buildProject(src);
        signatures.set(src.path, sig);
        changed = true;
        console.log(`↻ ${p.title} — ${p.pages.length} page(s)`);
      } catch (e) {
        // Fichier en cours d'écriture (téléchargement) : on réessaiera au prochain passage.
        console.warn(`! ${src.name} : ${String(e.message).split('\n')[0]}`);
        signatures.delete(src.path);
      }
    }
    for (const key of [...projects.keys()]) {
      if (seen.has(key)) continue;
      projects.delete(key);
      await fs.rm(path.join(CACHE, key), { recursive: true, force: true });
      changed = true;
    }
    if (changed) globalVersion++;
  })().finally(() => {
    scanning = null;
    if (rescan) {
      rescan = false;
      setTimeout(scan, 300);
    }
  });
  return scanning;
}

let timer = 0;
const scheduleScan = () => {
  clearTimeout(timer);
  timer = setTimeout(scan, 700);
};

// --- Pages HTML ---------------------------------------------------------------

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
const reloadScript = (key, version) =>
  `<script>(function(){var v=${version};setInterval(function(){fetch('/api/version/${key}',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){if(d.version&&d.version!==v)location.reload()}).catch(function(){})},1500)})();</script>`;

const STYLE = `
  :root { color-scheme: light dark; --bg:#f4f4f2; --card:#fff; --text:#161616; --muted:#6b6b6b; --line:#e3e3e0; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161615; --card:#1f1f1e; --text:#f1f0ec; --muted:#a3a29d; --line:#2e2e2c; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font: 16px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
         padding: max(20px, env(safe-area-inset-top)) 16px max(28px, env(safe-area-inset-bottom)); }
  main { max-width:560px; margin:0 auto; }
  header { margin: 8px 0 22px; }
  .eyebrow { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:0 0 4px; }
  h1 { font-size:26px; line-height:1.15; margin:0; font-weight:650; }
  section { margin-bottom:22px; }
  h2 { font-size:13px; font-weight:600; color:var(--muted); margin:0 0 8px; padding:0 4px; text-transform:uppercase; letter-spacing:.05em; }
  ul { list-style:none; margin:0; padding:0; background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
  li + li { border-top:1px solid var(--line); }
  a.row { display:flex; align-items:center; gap:12px; min-height:52px; padding:12px 16px; color:var(--text); text-decoration:none; }
  a.row:active { background:var(--line); }
  a.row .t { flex:1; }
  a.row .chev { color:var(--muted); font-size:20px; line-height:1; }
  .empty { background:var(--card); border:1px dashed var(--line); border-radius:14px; padding:20px; color:var(--muted); font-size:15px; }
  .empty code { font: 13px ui-monospace, Menlo, monospace; word-break: break-all; }
  .note { color:var(--muted); font-size:13px; margin:0 4px; }
`;

// Titre affiché : sans le suffixe de format (le téléphone affiche de toute façon la version mobile).
const displayTitle = (t) => t.replace(/\s*·\s*(desktop|mobile|tablette?|tablet)$/i, '');
const timeFr = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const HOME_STYLE = `
  .proj { margin-bottom: 30px; }
  .proj-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin:0 2px 12px; }
  .proj-head h2 { margin:0; padding:0; font-size:17px; font-weight:650; color:var(--text); text-transform:none; letter-spacing:0; }
  .proj-head span { color:var(--muted); font-size:13px; white-space:nowrap; }
  .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 18px 14px; }
  .card { display:block; color:var(--text); text-decoration:none; -webkit-tap-highlight-color: transparent; }
  .thumb { position:relative; aspect-ratio: 390 / 720; border-radius:16px; overflow:hidden; background:var(--card);
           border:1px solid var(--line); box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06);
           transition: transform .15s ease; }
  .card:active .thumb { transform: scale(.97); }
  .thumb::before { content:""; position:absolute; inset:0; background: linear-gradient(100deg, transparent 30%, rgba(127,127,127,.08) 50%, transparent 70%) var(--card);
                   background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
  .thumb iframe { position:absolute; top:0; left:0; width:390px; height:720px; border:0; background:#fff;
                  transform-origin: 0 0; transform: scale(var(--s, .38)); pointer-events:none; opacity:0; transition: opacity .3s ease; }
  .thumb iframe.ready { opacity:1; }
  .label { margin:10px 2px 0; font-size:14px; font-weight:550; line-height:1.3; }
  .sub { margin:2px 2px 0; font-size:12px; color:var(--muted); }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .thumb::before { animation:none; } .thumb, .thumb iframe { transition:none; } }
`;

function homePage() {
  const list = [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const sections = list.length
    ? list.map((p) => `<section class="proj">
  <div class="proj-head"><h2>${escapeHtml(p.title)}</h2><span>${p.pages.length} page${p.pages.length > 1 ? 's' : ''} · ${timeFr(p.updatedAt)}</span></div>
  ${p.pages.length
    ? `<div class="grid">${p.pages.map((pg) => {
        const href = `/p/${p.slug}/${encodeURI(pg.file)}`;
        return `<a class="card" href="${href}"><div class="thumb"><iframe src="${href}?thumb=1" loading="lazy" tabindex="-1" aria-hidden="true" scrolling="no"></iframe></div><p class="label">${escapeHtml(displayTitle(pg.title))}</p></a>`;
      }).join('')}</div>`
    : '<p class="note">Aucune page HTML dans ce projet.</p>'}
</section>`).join('')
    : `<div class="empty">Aucun projet pour l’instant. Dans Claude, exporte une frame (⬇ « Export this artboard » → <strong>HTML (.zip)</strong>) et dépose le zip dans <code>${escapeHtml(WATCH_DIR)}</code>.</div>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">${VIEWPORT}
<title>Super CDesign</title><style>${STYLE}${HOME_STYLE}</style></head><body><main>
<header><p class="eyebrow">Preview mobile</p><h1>Super CDesign</h1></header>
${sections}
</main>
<script>
(function(){
  // Aperçus : la page est rendue à la largeur d'un téléphone (390 px) puis réduite à la taille de la carte.
  var ro = new ResizeObserver(function(entries){ entries.forEach(function(e){ e.target.style.setProperty('--s', e.contentRect.width / 390); }); });
  document.querySelectorAll('.thumb').forEach(function(t){ ro.observe(t); });
  document.querySelectorAll('.thumb iframe').forEach(function(f){ f.addEventListener('load', function(){ setTimeout(function(){ f.classList.add('ready'); }, 250); }); });
  var v=${globalVersion};
  setInterval(function(){fetch('/api/state',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){if(d.version!==v)location.reload()}).catch(function(){})},2000);
})();
</script>
</body></html>`;
}

function missingPage(p, rel) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">${VIEWPORT}
<title>Page absente</title><style>${STYLE}</style></head><body><main>
<header><p class="eyebrow">${escapeHtml(p.title)}</p><h1>Cette page n’est pas dans le projet</h1></header>
<div class="empty">Exporte une frame de la page <strong>${escapeHtml(rel.replace(/\.dc\.html?$|\.html?$/i, ''))}</strong> en HTML (.zip) et dépose-la dans le dossier <code>${escapeHtml(path.basename(p.source))}</code>. Cet écran se mettra à jour tout seul.</div>
<p class="note" style="margin-top:16px"><a href="/" style="color:inherit">← Tous les projets</a></p>
</main>${reloadScript(p.slug, p.version)}</body></html>`;
}

// --- Serveur HTTP ---------------------------------------------------------------

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function servePage(req, res, p, rest, thumb) {
  let rel = decodeURIComponent(rest || '');
  if (!rel || rel.endsWith('/')) rel = rel + (rel ? 'index.html' : p.pages[0]?.file || 'index.html');
  const file = path.resolve(p.dir, rel);
  if (!file.startsWith(p.dir + path.sep)) return send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
  const ext = path.extname(file).toLowerCase();
  const isHtml = ext === '.html' || ext === '.htm';
  let data;
  try {
    data = await fs.readFile(file);
  } catch {
    if (isHtml) return send(res, 200, missingPage(p, rel), TYPES['.html']);
    return send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
  }
  if (isHtml) {
    let html = data.toString('utf8');
    if (!/<meta[^>]+name=["']?viewport/i.test(html)) {
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + '\n' + VIEWPORT) : VIEWPORT + html;
    }
    const inject = thumb ? '' : reloadScript(p.slug, p.version);
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, inject + '</body>') : html + inject;
    data = Buffer.from(html, 'utf8');
  }
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : data);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Méthode non autorisée' });
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    let m;
    if (p === '/') return send(res, 200, homePage(), TYPES['.html']);
    if (p === '/api/state') return send(res, 200, { version: globalVersion });
    if (p === '/api/qr') {
      const target = homeUrl();
      const svg = await QRCode.toString(target, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
      return send(res, 200, { url: target, svg, dir: WATCH_DIR, projects: projects.size });
    }
    if ((m = /^\/api\/version\/([^/]+)$/.exec(p))) {
      const proj = projects.get(m[1]);
      return send(res, 200, proj ? { version: proj.version } : {});
    }
    if ((m = /^\/p\/([^/]+)(?:\/(.*))?$/.exec(p))) {
      const proj = projects.get(m[1]);
      if (!proj) {
        res.writeHead(302, { Location: '/' });
        return res.end();
      }
      if (m[2] === undefined) {
        res.writeHead(302, { Location: `/p/${proj.slug}/` });
        return res.end();
      }
      return await servePage(req, res, proj, m[2], url.searchParams.has('thumb'));
    }
    send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

await fs.mkdir(WATCH_DIR, { recursive: true });
await fs.mkdir(CACHE, { recursive: true });
await scan();
watch(WATCH_DIR, { recursive: true }, scheduleScan);
setInterval(scan, 5000); // filet de sécurité si un événement du système de fichiers est manqué

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Super CDesign : ${homeUrl()}`);
  console.log(`Dossier surveillé : ${WATCH_DIR}`);
});
