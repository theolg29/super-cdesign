// Super CDesign — page de réglages (ouverte par un clic sur l'icône de l'extension).
// Elle parle directement au serveur local (l'extension a accès à localhost).

const SERVER = 'http://localhost:4321';
const $ = (id) => document.getElementById(id);
let state = null;
let busy = false;

document.getElementById('version').textContent = chrome.runtime.getManifest().version;

async function api(path, body) {
  const res = await fetch(SERVER + path, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
  return json;
}

function say(text, kind) {
  const m = $('msg');
  m.textContent = text || '';
  m.dataset.kind = kind || '';
}

function setStatus(on) {
  const s = $('status');
  s.dataset.state = on ? 'on' : 'off';
  s.lastElementChild.textContent = on ? 'Serveur actif' : 'Serveur arrêté';
  $('online').hidden = !on;
  $('offline').hidden = on;
}

const shortUrl = (u) => u.replace(/^http:\/\//, '').replace(/\/$/, '');
const timeFr = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function render(c) {
  state = c;
  setStatus(true);

  // QR code (SVG généré par le serveur local, nettoyé avant insertion)
  const svg = new DOMParser().parseFromString(c.svg, 'image/svg+xml').documentElement;
  if (svg && svg.nodeName === 'svg') {
    svg.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
    $('qr').replaceChildren(document.importNode(svg, true));
  }
  $('url').textContent = shortUrl(c.url);
  $('url').href = c.url;
  $('open-home').href = c.url;
  $('ip').textContent = `Adresse IP : ${shortUrl(c.ipUrl)} (si un appareil ne reconnaît pas le nom)`;

  // Nom de l'adresse
  if (document.activeElement !== $('host')) $('host').value = c.host;
  $('host').disabled = c.hostLocked;
  $('host-hint').textContent = c.hostLocked
    ? 'Fixé par la variable SUPERDESIGN_HOST au lancement du serveur.'
    : 'Lettres, chiffres et tirets. Après un changement, rescanne le QR code.';

  // Dossier
  $('dir').textContent = c.dir;
  for (const id of ['pick-folder', 'reset-folder']) $(id).disabled = c.dirLocked;
  $('reset-folder').hidden = c.dir === c.defaultDir;

  // Démarrage automatique
  $('autostart-field').hidden = !c.autostart.supported;
  $('autostart').checked = c.autostart.enabled;

  // Projets
  $('count').textContent = c.projects.length ? `· ${c.projects.length}` : '';
  const list = $('projects');
  list.replaceChildren();
  if (!c.projects.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Aucun projet pour l’instant. Dépose un export HTML (.zip) dans le dossier des exports.';
    list.append(p);
  }
  for (const proj of c.projects) {
    const item = document.createElement('div');
    item.className = 'project';
    const head = document.createElement('div');
    head.className = 'project-head';
    const name = document.createElement('strong');
    name.textContent = proj.title;
    const meta = document.createElement('span');
    meta.className = 'muted small';
    meta.textContent = `${proj.pages.length} page${proj.pages.length > 1 ? 's' : ''} · ${timeFr(proj.updatedAt)}`;
    head.append(name, meta);
    const pages = document.createElement('div');
    pages.className = 'pages';
    for (const pg of proj.pages) {
      const a = document.createElement('a');
      a.href = pg.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = pg.title.replace(/\s*·\s*(desktop|mobile|tablette?|tablet)$/i, '');
      pages.append(a);
    }
    item.append(head, pages);
    list.append(item);
  }
}

async function refresh() {
  if (busy) return;
  try {
    render(await api('/api/config'));
  } catch {
    setStatus(false);
  }
}

async function act(fn, okText) {
  busy = true;
  say('');
  try {
    const r = await fn();
    if (r && r.svg) render(r);
    if (okText) say(okText, 'ok');
  } catch (e) {
    say(e.message, 'error');
  } finally {
    busy = false;
  }
}

$('host-form').addEventListener('submit', (e) => {
  e.preventDefault();
  act(() => api('/api/config', { host: $('host').value }), 'Nom enregistré. Rescanne le QR code sur les téléphones.');
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.url);
    say('Adresse copiée.', 'ok');
  } catch {
    say('Copie impossible : sélectionne l’adresse à la main.', 'error');
  }
});

$('open-folder').addEventListener('click', () => act(() => api('/api/open-folder', {})));

$('pick-folder').addEventListener('click', () => {
  if (!state.canPickFolder) {
    $('dir-form').hidden = false;
    $('dir-input').value = state.dir;
    $('dir-input').focus();
    return;
  }
  act(async () => {
    say('Choisis le dossier dans la fenêtre du Finder…');
    const r = await api('/api/pick-folder', {});
    if (r.cancelled) return say('');
    if (r.unsupported) {
      $('dir-form').hidden = false;
      return null;
    }
    return api('/api/config', { dir: r.dir });
  }, null).then(() => {
    if ($('msg').textContent.startsWith('Choisis')) say('Dossier mis à jour.', 'ok');
  });
});

$('dir-form').addEventListener('submit', (e) => {
  e.preventDefault();
  act(() => api('/api/config', { dir: $('dir-input').value }), 'Dossier mis à jour.').then(() => {
    if ($('msg').dataset.kind === 'ok') $('dir-form').hidden = true;
  });
});

$('reset-folder').addEventListener('click', () => act(() => api('/api/config', { dir: '' }), 'Retour au dossier par défaut.'));

$('autostart').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  act(async () => {
    const r = await api('/api/autostart', { enabled });
    if (r.restarting) {
      say('Le serveur redémarre en mode automatique…');
      await new Promise((ok) => setTimeout(ok, 2500));
      return api('/api/config');
    }
    return api('/api/config');
  }, enabled ? 'Le serveur démarrera désormais avec le Mac.' : 'Démarrage automatique désactivé (le serveur tourne jusqu’au prochain redémarrage).');
});

refresh();
setInterval(refresh, 3000);
