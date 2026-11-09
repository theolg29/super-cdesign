// Super CDesign — page de réglages (ouverte par un clic sur l'icône de l'extension).
// Elle parle directement au serveur local (l'extension a accès à localhost).

const SERVER = 'http://localhost:5757';
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

  // Dossier
  $('dir').textContent = c.dir;
  for (const id of ['pick-folder', 'reset-folder']) $(id).disabled = c.dirLocked;
  $('reset-folder').hidden = c.dir === c.defaultDir;

  // Démarrage automatique
  $('autostart-field').hidden = !c.autostart.supported;
  $('autostart').checked = c.autostart.enabled;

  // Projets (reconstruits seulement s'ils changent, pour ne pas recharger les aperçus)
  $('count').textContent = c.projects.length ? `· ${c.projects.length}` : '';
  $('delete-all').hidden = !c.projects.length;
  $('trash-note').textContent = c.projects.length
    ? (c.trash ? 'Supprimer envoie les fichiers à la Corbeille.' : 'Attention : la suppression est définitive.')
    : '';
  const sig = JSON.stringify(c.projects.map((p) => [p.slug, p.version, p.pages.map((pg) => pg.file)]));
  if (sig !== lastProjectsSig) {
    lastProjectsSig = sig;
    renderProjects(c);
  }
}

const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const cleanTitle = (t) => t.replace(/\s*·\s*(desktop|mobile|tablette?|tablet)$/i, '');
let lastProjectsSig = '';
const thumbObserver = new ResizeObserver((entries) => {
  for (const e of entries) e.target.style.setProperty('--s', e.contentRect.width / 390);
});

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function renderProjects(c) {
  const list = $('projects');
  list.replaceChildren();
  if (!c.projects.length) {
    list.append(el('p', 'empty', 'Aucun projet pour l’instant. Dépose un export HTML (.zip) dans le dossier des exports.'));
    return;
  }
  const where = c.trash ? ' Le fichier part dans la Corbeille.' : ' La suppression est définitive.';
  for (const proj of c.projects) {
    const item = el('div', 'project');
    const head = el('div', 'project-head');
    const meta = el('span', 'meta');
    meta.append(el('span', 'muted small', `${proj.pages.length} page${proj.pages.length > 1 ? 's' : ''} · ${timeFr(proj.updatedAt)}`));
    const delProj = el('button', 'link-btn', 'Supprimer le projet');
    delProj.type = 'button';
    delProj.addEventListener('click', () => {
      if (!confirm(`Supprimer le projet « ${proj.title} » et toutes ses pages ?${where}`)) return;
      act(() => api('/api/delete', { project: proj.slug }), `Projet « ${proj.title} » supprimé.`);
    });
    meta.append(delProj);
    head.append(el('strong', '', proj.title), meta);

    const grid = el('div', 'thumbs');
    for (const pg of proj.pages) {
      const tile = el('div', 'tile');
      const a = el('a');
      a.href = pg.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = `Ouvrir « ${cleanTitle(pg.title)} »`;
      const frame = el('div', 'frame');
      const iframe = document.createElement('iframe');
      iframe.src = pg.thumb;
      iframe.loading = 'lazy';
      iframe.tabIndex = -1;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('scrolling', 'no');
      frame.append(iframe);
      thumbObserver.observe(frame);
      a.append(frame, el('p', 'tile-title', cleanTitle(pg.title)));
      tile.append(a);
      if (pg.deletable) {
        const del = el('button', 'icon-btn');
        del.type = 'button';
        del.innerHTML = TRASH_ICON;
        del.setAttribute('aria-label', `Supprimer la page « ${cleanTitle(pg.title)} »`);
        del.title = 'Supprimer cette page';
        del.addEventListener('click', () => {
          const last = proj.pages.length === 1 ? ' C’est la seule page : le projet sera supprimé.' : '';
          if (!confirm(`Supprimer la page « ${cleanTitle(pg.title)} » ?${last}${where}`)) return;
          act(() => api('/api/delete', { project: proj.slug, file: pg.file }), `Page « ${cleanTitle(pg.title)} » supprimée.`);
        });
        tile.append(del);
      }
      grid.append(tile);
    }
    item.append(head, grid);
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

$('delete-all').addEventListener('click', () => {
  const n = state.projects.length;
  const where = state.trash ? 'Les fichiers partent dans la Corbeille.' : 'La suppression est définitive.';
  if (!confirm(`Supprimer les ${n} projet${n > 1 ? 's' : ''} du dossier des exports ? ${where}`)) return;
  act(() => api('/api/delete-all', {}), 'Dossier des exports vidé.');
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
