(() => {
  const MSG = '__superdesign';
  const IS_CLAUDE = location.hostname === 'claude.ai';

  if (IS_CLAUDE) runOnClaude();
  else runInViewerFrame();

  // ===========================================================================
  // 1) claude.ai
  //    - Panneau d'artéfact (chat) : bouton « Présenter » qui ouvre l'artéfact
  //      publié dans un nouvel onglet avec ?superdesign=present.
  //    - Menu PLAY d'une frame (dans l'iframe) : option « Play new tab », qui
  //      ouvre l'onglet de présentation directement sur cette frame.
  //    - Page /artifact/...?superdesign=present : masque la barre Claude
  //      (claude.css) et rogne la barre du viewer en remontant l'iframe de la
  //      hauteur mesurée dedans.
  // ===========================================================================
  function runOnClaude() {
    const PARAM = 'superdesign';
    const PLAY_PARAM = 'superdesign_play';
    const isArtifactPage = () => /^\/(code\/)?artifact\//.test(location.pathname);

    // Mode présentation (et frame à lancer) : lus dans l'URL, mémorisés pour l'onglet.
    const params = new URLSearchParams(location.search);
    const store = (k, v) => {
      try {
        if (v !== null) sessionStorage.setItem(k + ':' + location.pathname, v);
        return sessionStorage.getItem(k + ':' + location.pathname);
      } catch (e) {
        return v;
      }
    };
    const present = store('superdesign-present', params.get(PARAM) === 'present' ? '1' : null) === '1';
    const autoplayLabel = present ? store('superdesign-play', params.get(PLAY_PARAM)) : null;

    let barHeight = 0; // hauteur de la barre du viewer, mesurée dans l'iframe
    let autoplayPending = !!autoplayLabel;
    const effective = () => isArtifactPage() && present;

    const isViewerOrigin = (origin) => {
      try {
        return new URL(origin).hostname.endsWith('.claudeusercontent.com');
      } catch (e) {
        return false;
      }
    };
    const contentFrames = () =>
      [...document.querySelectorAll('iframe')].filter((f) => isViewerOrigin(f.src));
    const viewerFrame = () =>
      isArtifactPage() ? document.getElementById('frame-content') || contentFrames()[0] || null : null;

    // --- Lien de l'artéfact publié ------------------------------------------
    // Lien « Ouvrir cet artéfact dans un nouvel onglet » du panneau : on remonte
    // depuis l'élément jusqu'au panneau (celui qui contient le bouton Partager).
    function artifactLink(from) {
      const doc = from.ownerDocument || document;
      for (let p = from; p && p !== doc.documentElement; p = p.parentElement) {
        if (!p.querySelector) continue;
        const a = p.querySelector('a[href*="/artifact/"][target="_blank"]') ||
          (p.querySelector('button[data-share-audience]') && p.querySelector('a[href*="/artifact/"]'));
        if (a) return a.href;
        if (p.querySelector('button[data-share-audience]')) break;
      }
      const all = doc.querySelectorAll('a[href*="/artifact/"][target="_blank"]');
      return all.length === 1 ? all[0].href : null;
    }
    // Page intégrée dans le panneau d'un chat (claude.ai/code/artifact/... en
    // iframe) : le lien publié se trouve dans la page du chat, même origine.
    function hostPublishedLink() {
      try {
        const fe = window.frameElement;
        return fe ? artifactLink(fe) : null;
      } catch (e) {
        return null;
      }
    }
    const isEmbedded = window !== window.top;
    const presentBase = (frame) => {
      if (isEmbedded) return hostPublishedLink() || (isArtifactPage() ? location.origin + location.pathname : null);
      return isArtifactPage() ? location.origin + location.pathname : artifactLink(frame);
    };

    function openPresent(base, playLabel, pageHash) {
      const url = new URL(base, location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set(PARAM, 'present');
      if (playLabel) url.searchParams.set(PLAY_PARAM, playLabel);
      if (pageHash && /^#page-[\w-]+$/.test(pageHash)) url.hash = pageHash;
      window.open(url.href, '_blank', 'noopener');
    }

    // --- Communication avec les iframes -------------------------------------
    const lastState = new WeakMap();
    function stateFor(f) {
      const isViewer = f === viewerFrame();
      return {
        watch: isViewer && effective(),
        canPresent: !!presentBase(f),
        autoplay: isViewer && effective() && autoplayPending ? autoplayLabel : null,
      };
    }
    function tellFrame(f, force) {
      if (!f || !f.contentWindow) return;
      const s = stateFor(f);
      const sig = JSON.stringify(s);
      if (!force && lastState.get(f) === sig) return;
      lastState.set(f, sig);
      try {
        f.contentWindow.postMessage({ [MSG]: 1, type: 'state', ...s }, new URL(f.src).origin);
      } catch (e) {
        /* iframe en cours de navigation */
      }
    }

    function applyCrop() {
      const f = viewerFrame();
      if (!f) return;
      if (effective() && barHeight > 0) {
        f.style.setProperty('top', `-${barHeight}px`, 'important');
        f.style.setProperty('height', `calc(100% + ${barHeight}px)`, 'important');
      } else {
        f.style.removeProperty('top');
        f.style.removeProperty('height');
      }
      // Pendant le lancement automatique de la frame, on cache le canvas.
      if (effective() && autoplayPending) f.style.setProperty('opacity', '0', 'important');
      else f.style.removeProperty('opacity');
    }

    function endAutoplay() {
      if (!autoplayPending) return;
      autoplayPending = false;
      applyCrop();
      const f = viewerFrame();
      if (f) tellFrame(f);
    }
    if (autoplayPending) setTimeout(endAutoplay, 10000); // filet de sécurité

    // Dès que le viewer a lancé la frame, l'URL porte son identifiant
    // (#play-…). Le lancement simulé peut laisser un affichage incorrect
    // (animation figée, mauvais mode) : on recharge donc l'onglet sur ce lien
    // direct, que le viewer ouvre nativement en plein écran.
    function checkPlayHash() {
      if (!effective() || !autoplayPending) return;
      if (!/^#play-[\w-]+$/.test(location.hash)) return;
      autoplayPending = false;
      try {
        sessionStorage.removeItem('superdesign-play:' + location.pathname);
      } catch (e) {
        /* ignore */
      }
      const url = new URL(location.href);
      url.searchParams.delete(PLAY_PARAM);
      url.searchParams.set(PARAM, 'present');
      location.replace(url.href);
    }
    if (autoplayPending) {
      const iv = setInterval(() => (autoplayPending ? checkPlayHash() : clearInterval(iv)), 100);
      window.addEventListener('hashchange', checkPlayHash);
    }

    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d[MSG] !== 1 || !isViewerOrigin(e.origin)) return;
      const f = contentFrames().find((x) => x.contentWindow === e.source);
      if (!f) return;
      if (d.type === 'hello') tellFrame(f, true);
      if (d.type === 'bar' && typeof d.h === 'number' && f === viewerFrame()) {
        barHeight = Math.max(0, Math.min(120, Math.round(d.h)));
        applyCrop();
      }
      if (d.type === 'autoplay-done' && f === viewerFrame()) endAutoplay();
      if (d.type === 'open-present') {
        const base = presentBase(f);
        if (!base) return;
        const label = typeof d.label === 'string' ? d.label.slice(0, 150) : null;
        const pageHash = isArtifactPage() && location.hash.startsWith('#page-') ? location.hash : d.pageHash;
        openPresent(base, label, pageHash);
      }
    });

    // --- Boutons de l'en-tête du panneau d'artéfact ------------------------------
    // « Présenter » (artéfact publié) et « Preview mobile » (QR code du serveur
    // local), clonés du bouton « Développer » pour avoir le style natif.
    const ICON_PRESENT =
      '<rect x="3" y="4" width="18" height="12.5" rx="2"/>' +
      '<path d="M8.5 20.5h7M12 16.5v4"/>' +
      '<path d="M10.25 7.75v5l4.25-2.5z" fill="currentColor" stroke-linejoin="round"/>';
    const ICON_MOBILE =
      '<rect x="6.5" y="2.75" width="11" height="18.5" rx="2.5"/>' +
      '<path d="M10.5 18h3"/>';
    const LABEL_PRESENT = "Présenter sans l'interface Claude";
    const LABEL_MOBILE = 'Preview mobile (QR code)';

    function makeButton(ref, icon, label, kind, onClick) {
      const btn = ref.cloneNode(true);
      for (const el of [btn, ...btn.querySelectorAll('*')]) {
        for (const attr of [...el.attributes]) {
          if (attr.name === 'id' || attr.name === 'data-testid' || attr.name.startsWith('data-pane') ||
              attr.name.startsWith('data-base-ui') || attr.name.startsWith('aria-') ||
              attr.name === 'data-state' || attr.name === 'data-popup-open') {
            el.removeAttribute(attr.name);
          }
        }
      }
      // Les icônes Claude sont un glyphe de police dans span[data-cds="Icon"]
      // (ou un <svg> selon les versions) : on remplace le contenu par notre SVG.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '20');
      svg.setAttribute('height', '20');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.6');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.display = 'block';
      svg.innerHTML = icon;
      const iconSlot = btn.querySelector('[data-cds="Icon"]');
      const oldSvg = btn.querySelector('svg');
      if (iconSlot) iconSlot.replaceChildren(svg);
      else if (oldSvg) oldSvg.replaceWith(svg);
      else btn.append(svg);

      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.setAttribute('data-superdesign-' + kind, '');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(btn);
      });
      return btn;
    }

    function injectButtons() {
      for (const share of document.querySelectorAll('button[data-share-audience]')) {
        const row = share.parentElement;
        if (!row) continue;
        const ref = row.querySelector(':scope > [data-pane-expanded]') ||
          [...row.children].find((c) => c.matches('button[data-cds-icon-only]'));
        if (!ref) continue;
        if (!row.querySelector('[data-superdesign-mobile]')) {
          row.insertBefore(makeButton(ref, ICON_MOBILE, LABEL_MOBILE, 'mobile', toggleMobilePopover), ref);
        }
        // « Présenter » : seulement pour un artéfact publié (il faut un lien à ouvrir).
        if (!row.querySelector('[data-superdesign-present]') && artifactLink(share)) {
          row.insertBefore(makeButton(ref, ICON_PRESENT, LABEL_PRESENT, 'present', () => {
            const base = artifactLink(share);
            if (base) openPresent(base, null, null);
          }), row.querySelector('[data-superdesign-mobile]') || ref);
        }
      }
    }

    // --- Fenêtre « Preview mobile » -------------------------------------------------
    // Affiche le QR code de l'accueil du serveur local (via le service worker,
    // qui seul peut joindre localhost). Rien n'est envoyé à Claude.
    let popover = null;
    function closeMobilePopover() {
      if (!popover) return;
      popover.remove();
      popover = null;
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onEscape, true);
    }
    const onOutside = (e) => {
      if (popover && !popover.contains(e.target) && !e.target.closest?.('[data-superdesign-mobile]')) closeMobilePopover();
    };
    const onEscape = (e) => e.key === 'Escape' && closeMobilePopover();

    function el(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      return n;
    }

    function toggleMobilePopover(btn) {
      if (popover) return closeMobilePopover();
      popover = el('div', 'superdesign-pop');
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-label', 'Preview mobile');
      popover.append(el('p', 'superdesign-pop__eyebrow', 'Preview mobile'), el('p', 'superdesign-pop__msg', 'Connexion au serveur…'));
      document.body.append(popover);
      const r = btn.getBoundingClientRect();
      const w = 300;
      popover.style.setProperty('top', `${Math.round(r.bottom + 8)}px`);
      popover.style.setProperty('left', `${Math.round(Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w)))}px`);
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onEscape, true);

      const pop = popover;
      chrome.runtime.sendMessage({ type: 'superdesign-qr' }).then((res) => {
        if (pop !== popover) return;
        pop.replaceChildren(el('p', 'superdesign-pop__eyebrow', 'Preview mobile'));
        if (!res || !res.ok) {
          pop.append(
            el('p', 'superdesign-pop__title', 'Le serveur ne répond pas'),
            el('p', 'superdesign-pop__msg', 'Lance-le dans un terminal :'),
            el('code', 'superdesign-pop__code', 'cd server && npm start')
          );
          return;
        }
        const doc = new DOMParser().parseFromString(res.svg, 'image/svg+xml');
        const svg = doc.documentElement;
        const qr = el('div', 'superdesign-pop__qr');
        if (svg && svg.nodeName === 'svg') {
          svg.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
          qr.append(document.importNode(svg, true));
        }
        const link = el('a', 'superdesign-pop__url', res.url.replace(/^http:\/\//, '').replace(/\/$/, ''));
        link.href = res.url;
        link.target = '_blank';
        link.rel = 'noopener';
        pop.append(
          qr,
          link,
          el('p', 'superdesign-pop__msg', 'Scanne avec le téléphone (même Wi-Fi), puis choisis la page à ouvrir.'),
          el('p', 'superdesign-pop__msg', 'Pour ajouter un projet : ⬇ « Export this artboard » → HTML (.zip), puis dépose le zip dans'),
          el('code', 'superdesign-pop__code', res.dir.replace(/^\/Users\/[^/]+/, '~'))
        );
      });
    }

    // --- Suivi du DOM (SPA : panneaux et iframes recréés) ----------------------
    function render() {
      if (effective()) document.documentElement.setAttribute('data-superdesign', 'on');
      else document.documentElement.removeAttribute('data-superdesign');
      injectButtons();
      applyCrop();
      for (const f of contentFrames()) tellFrame(f);
    }

    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        render();
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    render();
  }

  // ===========================================================================
  // 2) Iframe du viewer (*.claudeusercontent.com, posée directement dans
  //    claude.ai). Jamais dans les iframes imbriquées (le site présenté).
  //    - mesure la barre « START_Accueil … Fill / Fit » pour que la page la
  //      fasse sortir du cadre ;
  //    - ajoute « Play new tab » au menu PLAY des frames ;
  //    - dans l'onglet de présentation, lance la frame demandée en plein écran.
  // ===========================================================================
  function runInViewerFrame() {
    // Le viewer est l'iframe dont le parent direct est une page claude.ai
    // (page /artifact/ ou page intégrée dans le panneau d'un chat).
    const ancestors = location.ancestorOrigins;
    const isViewerFrame = window !== window.top && !!ancestors && ancestors[0] === 'https://claude.ai';
    if (!isViewerFrame) return;

    const PARENT_ORIGIN = 'https://claude.ai';
    const send = (data) => window.parent.postMessage({ [MSG]: 1, ...data }, PARENT_ORIGIN);
    // Normalise un texte : retire les glyphes d'icônes (police d'icônes = zone
    // d'usage privé Unicode) et les caractères invisibles, puis les espaces superflus.
    const norm = (s) => (s || '').replace(/[\p{Co}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
    const W = () => window.innerWidth;

    // --- Mesure de la barre du viewer ---------------------------------------
    const MODE_WORD = /^(fill|fit|remplir|ajuster)$/i;

    // Une « barre » : pleine largeur, collée en haut, peu haute, avec des boutons,
    // et sans iframe dedans (sinon c'est le conteneur du site).
    function looksLikeBar(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      const r = el.getBoundingClientRect();
      return (
        r.width >= W() * 0.8 &&
        r.top <= 4 &&
        r.height >= 20 &&
        r.height <= 90 &&
        !el.querySelector('iframe') &&
        el.querySelector('button, [role="button"], a') !== null
      );
    }

    function byModeButtons() {
      for (const el of document.querySelectorAll('button, [role="button"], [role="radio"], [role="tab"], label')) {
        const t = norm(el.textContent);
        const a = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (!MODE_WORD.test(t) && !MODE_WORD.test(a)) continue;
        let found = null;
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (p.getBoundingClientRect().height > 90) break;
          if (looksLikeBar(p)) found = p;
        }
        if (found) return found;
      }
      return null;
    }

    function byLayout() {
      for (const x of [12, W() / 2, W() - 12]) {
        const el = document.elementFromPoint(x, 6);
        if (!el || el.tagName === 'IFRAME') continue;
        let found = null;
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          if (p.getBoundingClientRect().height > 90) break;
          if (looksLikeBar(p)) found = p;
        }
        if (found) return found;
      }
      return null;
    }

    let watching = false;
    let lastH = -1;
    function measure() {
      if (!watching) return;
      const bar = byModeButtons() || byLayout();
      const h = bar ? Math.round(bar.getBoundingClientRect().bottom) : 0;
      if (h === lastH) return;
      lastH = h;
      send({ type: 'bar', h });
    }

    // --- Frames et menu PLAY --------------------------------------------------
    const PLAY_WORD = /^play$/i;
    const FULLSCREEN_ITEM = /^(play full screen|lire en plein écran|plein écran)$/i;
    const NEW_TAB_TEXT = 'Play new tab';

    const playButtons = () =>
      [...document.querySelectorAll('button, [role="button"]')].filter((b) => PLAY_WORD.test(norm(b.textContent)));

    // Titre de la frame d'un bouton PLAY : le texte de sa ligne d'en-tête, sans « PLAY ».
    function frameLabel(btn) {
      const own = norm(btn.textContent);
      for (let p = btn.parentElement, i = 0; p && i < 6; p = p.parentElement, i++) {
        const t = norm(p.textContent);
        if (t.length > own.length) return t.replace(/\s*play\s*$/i, '').trim().slice(0, 150);
      }
      return '';
    }

    // Élément de menu visible dont le texte propre correspond à `re`.
    function menuItem(re) {
      const res = document.evaluate(
        "//*[not(self::script) and not(self::style)][text()[normalize-space(.)!='']]",
        document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < res.snapshotLength; i++) {
        const el = res.snapshotItem(i);
        if (el.closest('[data-superdesign-item]')) continue;
        const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' '));
        if (!re.test(own) && !re.test(norm(el.textContent))) continue;
        if (el.getBoundingClientRect().height === 0) continue;
        return el.closest('[role="menuitem"]') || el.closest('button') || el;
      }
      return null;
    }
    const fullscreenItem = () => menuItem(FULLSCREEN_ITEM);

    let canPresent = false;
    let lastPlayButton = null;
    let menuWatchUntil = 0; // on ne cherche le menu qu'après un clic sur PLAY
    const notePlay = (e) => {
      const b = e.target instanceof Element && e.target.closest('button, [role="button"]');
      if (b && PLAY_WORD.test(norm(b.textContent))) {
        lastPlayButton = b;
        menuWatchUntil = Date.now() + 5000;
        setTimeout(schedule, 50);
      }
    };
    document.addEventListener('pointerdown', notePlay, true);
    document.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && notePlay(e), true);

    function closeMenu() {
      const opts = { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true };
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', opts));
      document.dispatchEvent(new KeyboardEvent('keyup', opts));
    }

    // Clone un élément du menu natif (même style) avec un autre texte et une action.
    function makeItem(model, text, kind, onActivate) {
      const clone = model.cloneNode(true);
      for (const el of [clone, ...clone.querySelectorAll('*')]) {
        el.removeAttribute('id');
        for (const attr of [...el.attributes]) {
          if (attr.name.startsWith('data-highlighted') || attr.name === 'data-state' ||
              attr.name.startsWith('data-superdesign')) el.removeAttribute(attr.name);
        }
      }
      // Remplace le texte « Play full screen » en gardant la mise en forme.
      const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (FULLSCREEN_ITEM.test(norm(n.nodeValue))) {
          n.nodeValue = text;
          break;
        }
      }
      clone.setAttribute('data-superdesign-item', kind);
      clone.setAttribute('tabindex', '-1');
      clone.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const btn = lastPlayButton && lastPlayButton.isConnected ? lastPlayButton : null;
        closeMenu();
        onActivate(btn);
      }, true);
      for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
        clone.addEventListener(t, (e) => e.stopPropagation(), true);
      }
      // Survol : reprend l'état visuel « actif » des autres éléments du menu.
      clone.addEventListener('pointerenter', () => clone.setAttribute('data-highlighted', ''));
      clone.addEventListener('pointerleave', () => clone.removeAttribute('data-highlighted'));
      return clone;
    }

    function addMenuItems() {
      if (Date.now() > menuWatchUntil && !document.querySelector('[role="menu"]')) return;
      const item = fullscreenItem();
      if (!item || !item.parentElement || item.parentElement.querySelector('[data-superdesign-item]')) return;
      if (!canPresent) return;
      const newTab = makeItem(item, NEW_TAB_TEXT, 'newtab', (btn) => {
        const label = btn ? frameLabel(btn) : '';
        const pageHash = /^#page-[\w-]+$/.test(location.hash) ? location.hash : null;
        send({ type: 'open-present', label, pageHash });
      });
      item.after(newTab);
    }

    // --- Lancement automatique de la frame (onglet de présentation) -----------
    let autoplayLabel = null;
    let autoplayDone = false;
    let autoplayStep = 'play';
    let autoplayStart = 0;

    function press(el) {
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerType: 'mouse', isPrimary: true }));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerType: 'mouse', isPrimary: true }));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.dispatchEvent(new MouseEvent('click', o));
    }

    function finishAutoplay() {
      autoplayDone = true;
      send({ type: 'autoplay-done' });
    }

    function stepAutoplay() {
      if (!autoplayLabel || autoplayDone) return;
      if (!autoplayStart) autoplayStart = Date.now();
      if (Date.now() - autoplayStart > 8000) return finishAutoplay();

      if (autoplayStep === 'play') {
        const btn = playButtons().find((b) => frameLabel(b) === autoplayLabel);
        if (!btn) return;
        btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        lastPlayButton = btn;
        press(btn);
        autoplayStep = 'menu';
        return;
      }
      if (autoplayStep === 'menu') {
        const item = fullscreenItem();
        if (!item) return;
        press(item);
        autoplayStep = 'wait';
        setTimeout(finishAutoplay, 400);
      }
    }

    // --- Boucle -----------------------------------------------------------------
    let scheduled = false;
    function tick() {
      scheduled = false;
      measure();
      addMenuItems();
      stepAutoplay();
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(tick);
    }
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    window.addEventListener('resize', schedule);
    setInterval(() => autoplayLabel && !autoplayDone && schedule(), 250);

    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d[MSG] !== 1 || e.source !== window.parent || e.origin !== PARENT_ORIGIN) return;
      if (d.type !== 'state') return;
      if (!!d.watch !== watching) {
        watching = !!d.watch;
        lastH = -1;
      }
      canPresent = !!d.canPresent;
      if (d.autoplay && !autoplayLabel) autoplayLabel = String(d.autoplay);
      schedule();
    });

    send({ type: 'hello' });
  }
})();
