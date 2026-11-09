# Super CDesign (Super Claude Design)

Extension Chrome (MV3) pour présenter un artéfact Claude (site Claude Design) à un client sans l'interface de Claude.

Fonctions :
- **Bouton « Présenter »** dans l'en-tête du panneau d'artéfact d'un chat (avant « Développer ») : ouvre l'artéfact publié dans un nouvel onglet avec `?superdesign=present`.
- **« Play new tab »** ajouté au menu PLAY de chaque frame du canvas (après « Play on canvas » / « Play full screen ») : ouvre l'onglet de présentation directement sur cette frame.
- **Onglet de présentation** (`claude.ai/artifact/<id>?superdesign=present`) : masque la barre Claude et rogne la barre du viewer.
- **Preview mobile** : bouton (icône téléphone) dans l'en-tête du panneau d'artéfact, qui affiche le QR code du serveur local (`server/`). Ce serveur sert sur le Wi-Fi les exports HTML déposés à la main dans `super-cdesign-exports/` (racine du projet).

L'essentiel est dans `content.js` (un seul fichier, deux rôles selon l'origine). `background.js` récupère le QR code auprès du serveur local et ouvre la page de réglages (`settings.html/.css/.js`, aussi `options_ui`) au clic sur l'icône.

Objectif produit : marcher pour tout le monde sur le réseau, sans manipulation compliquée (pas de terminal au quotidien, QR code qui marche sur tous les téléphones).

## Fichiers

- `manifest.json` : deux content scripts, un sur `https://claude.ai/*` (`document_start`, avec `claude.css`), un sur `https://*.claudeusercontent.com/*` (`document_idle`, `match_about_blank`). Les deux ont `all_frames`.
- `content.js` : `runOnClaude()` (pages claude.ai) ou `runInViewerFrame()` (iframe du viewer).
- `claude.css` : masque `#hdr`, `#top-edge`, `#hdr-degraded` et remonte `body > main` quand `html[data-superdesign="on"]`.
- `background.js` : répond au message `superdesign-qr` en interrogeant `http://localhost:5757/api/qr` (`{ url, svg, dir }`).
- `server/server.mjs` : serveur Node (dépendance unique : `qrcode`), lancé avec `cd server && npm start`. Port **5757** (choisi par l'utilisateur pour éviter 80 et 4321/Astro ; plus de port 80, qui bloquait MAMP/Docker quand le serveur démarre en premier), sur `0.0.0.0`. Adresse = IP du Mac sur le Wi-Fi (`http://192.168.x.x:5757/`), encodée dans le QR code. **Pas de nom `.local`** : essayé (mDNS via `multicast-dns`, puis `dns-sd -P`), pas vu par les autres appareils du réseau de l'utilisateur ; abandonné à sa demande (« on garde l'adresse IP »). Routes réservées à l'extension (requête locale ET Origin absent ou `chrome-extension://`) : `GET /api/qr`, `GET|POST /api/config` (`dir`, appliqué à chaud : dossier resurveillé), `POST /api/open-folder`, `POST /api/pick-folder` (sélecteur Finder via osascript), `POST /api/delete` (`{project, file?}` : la page vient du zip/HTML déposé, `origin` ; page seule → tout le projet), `POST /api/delete-all` (vide le dossier des exports), `POST /api/autostart` (agent launchd `com.supercdesign.server`, `~/Library/LaunchAgents`, logs `~/Library/Logs/super-cdesign.log` ; à l'activation le serveur libère ses ports et launchd le relance). Suppression : vers `~/.Trash` sur macOS (rename, récupérable), définitive ailleurs ; jamais hors du dossier des exports. Réglages dans `server/config.json` (exclu de git) ; les variables d'environnement priment. Les sous-dossiers de projet n'importent que zips, HTML et dossiers de ressources (jamais un dossier quelconque) ; dossier personnel et racine refusés comme dossier d'exports. Surveille `super-cdesign-exports/` à la racine du projet (variable `SUPERDESIGN_DIR` pour en changer) ; sites construits dans `server/.cache/<projet>/`. Les deux sont exclus de git (designs clients, dépôt public).
- `icons/` : générées avec Pillow (pas de source SVG dans le dépôt).
- `README.md` (public, en français), `INSTALL.md` (guide d'installation écrit pour les assistants IA : demander d'abord le dossier d'installation), `docs/hero.png`, `docs/dans-claude.png`, `docs/preview-mobile.png` (visuels du README, générés depuis des maquettes HTML avec un faux site « Atelier Nova » : ne jamais y mettre de design client), `docs/install-*.svg` (boutons « Installer avec Claude / ChatGPT » du README, logos Simple Icons, qui ouvrent claude.ai/new?q= et chatgpt.com/?q= avec la demande préremplie). Garder le texte de la demande identique dans les deux liens et dans le bloc à copier du README.

Après chaque modification, incrémente `version` dans `manifest.json`.

## Architecture

### Structure des frames
- Page publiée `claude.ai/artifact/<id>` : `div#frame-slot > iframe#frame-content` (viewer sur `<uuid>.frame.claudeusercontent.com`).
- Chat : le panneau contient une iframe **même origine** `claude.ai/code/artifact/<uuid>`, qui contient elle-même le viewer. Le viewer est donc le petit-enfant de la page du chat.
- Le viewer contient à son tour les iframes du site présenté. On les exclut : le script du viewer ne tourne que si `location.ancestorOrigins[0] === 'https://claude.ai'`.

### Communication par postMessage
Messages marqués `{ __superdesign: 1, type }`. L'origine et la source sont toujours vérifiées.
- Viewer → parent : `hello`, `bar {h}` (hauteur de la barre du viewer), `autoplay-done`, `open-present {label, pageHash}`.
- Parent → viewer : `state {watch, canPresent, autoplay}`.

### Onglet de présentation
- Le mode est mémorisé par onglet en `sessionStorage` (`superdesign-present:<pathname>`, `superdesign-play:<pathname>`). Le recharger garde donc le mode.
- La barre du viewer n'est pas masquée **dans** l'iframe (sinon bande noire en mode `#artboard` et barres d'outils du canvas disparues). Le parent rogne l'iframe à la place : `top:-Hpx; height:calc(100% + Hpx)`, avec H mesuré par le viewer.
- **Lancement d'une frame** (`superdesign_play=<titre de la frame>`) : le viewer clique sur le bouton PLAY dont le titre correspond. Dès que l'URL du parent passe à `#play-<id>`, le parent recharge sur `?superdesign=present#play-<id>`, sans `superdesign_play`. Le viewer ouvre ce lien direct nativement en plein écran. Le lancement simulé seul laissait des affichages incorrects (frame figée à moitié taille). L'iframe reste à `opacity:0` pendant le lancement, avec un filet de sécurité de 10 s.

### Preview mobile (serveur local)
- **Principe** : aucune automatisation côté Claude. L'utilisateur exporte lui-même (⬇ « Export this artboard » → HTML (.zip)) et dépose le zip dans `super-cdesign-exports/`. Le serveur surveille le dossier (`fs.watch` récursif + passage toutes les 5 s), reconstruit le projet modifié, et le téléphone se recharge seul (script injecté qui interroge `/api/version/<projet>` toutes les 1,5 s).
- **Projets** : un zip ou un `.html` à la racine = un projet. Un sous-dossier = un projet de plusieurs pages : ses zips sont décompressés dans un même site (du plus ancien au plus récent), et les liens entre pages (`href="Shop.dc.html"`) marchent. Lien vers une page absente → écran d'explication.
- **Contenu d'un export** : la page de la frame (`Main.dc.html`, `Checkout.dc.html`…), les composants qu'elle importe (`<dc-import name="Nav">` → `Nav.dc.html`), `support.js`, `vendor/react*.js`, `assets/` (noms par empreinte) et un `README.md` (« # Accueil · Desktop — design reference », « open `Main.dc.html` »). Pages = HTML qu'aucun autre n'importe par `dc-import` ; titres tirés du README.
- **Viewport** : l'export n'a pas de `<meta name="viewport">` ; le serveur l'ajoute, sinon le téléphone affiche la version bureau rétrécie.
- **Accueil** (`/`) : liste des projets et de leurs pages, pensée pour le téléphone ; se recharge quand un projet change.

### Approche abandonnée : export automatique (ne pas réintroduire sans en reparler)
Une version 1.6 simulait les clics « Export this artboard » → « HTML (.zip) », captait le zip et le renvoyait automatiquement quand le design était enregistré. Abandonnée à la demande de l'utilisateur : instable, et risque vis-à-vis des conditions d'utilisation de claude.ai (accès automatisé). Ce qu'on avait appris :
- Le viewer ne télécharge pas lui-même : il envoie à son parent `{ __frame_cap: true, cap: 'downloads', method: 'save', args: [{ filename, bytes: Blob }] }`, et claude.ai demande « Autoriser cet artéfact à télécharger un fichier ? ».
- Le viewer envoie aussi `{ __frame_chrome_report: true, snapshot: { v, saved, actions, exports } }` (`v` = version du format, pas du design).
- L'export « HTML » du menu Exporter de claude.ai (tout l'artéfact) ne contient que les frames de la page courante du canvas, en un seul HTML, et s'enregistre directement dans Téléchargements.

## Pièges connus

- **CSP de claude.ai** : un `<style>` injecté est bloqué. Passer par le CSS déclaré dans le manifest, ou par `style.setProperty(..., 'important')`.
- **Les icônes Claude sont des glyphes de police** (zone d'usage privé Unicode) dans `span[data-cds="Icon"]`, pas des SVG. Le texte du bouton PLAY vaut `<glyphe>Play`. Il faut toujours normaliser avec `norm()`, qui retire `[\p{Co}\p{Cf}]`.
- **Sélecteurs de l'interface Claude** (à revérifier après une mise à jour de Claude) :
  - `button[data-share-audience]` (Partager) ;
  - `[data-pane-expanded]` (Développer, cloné pour faire le bouton) ;
  - `a[href*="/artifact/"][target="_blank"]` (lien de l'artéfact publié) ;
  - les textes « Play » et « Play full screen », et « Fill » / « Fit » pour repérer la barre du viewer.
- Le bouton et l'option n'apparaissent que pour un artéfact **publié** (il faut un lien `claude.ai/artifact/…`).
- `window.open` depuis le parent fonctionne sur un message du viewer, parce que l'activation utilisateur se propage aux frames ancêtres.

## Tests (Claude in Chrome)

- Si le démarrage automatique est actif, le serveur tourne sous launchd (`pkill -f "node server.mjs"` ne le trouve pas) : après une modification de `server.mjs`, le relancer avec `launchctl kickstart -k gui/$(id -u)/com.supercdesign.server`. Logs : `~/Library/Logs/super-cdesign.log`.
- Ne pas pousser sur GitHub sans demande explicite de l'utilisateur.

- **Recharger l'extension** se fait sur `chrome://extensions`, ce que Claude in Chrome ne peut pas ouvrir. Il faut demander à l'utilisateur de cliquer sur ↻, ou ajouter temporairement un rechargement automatique de développement (à retirer ensuite).
- Le viewer est **cross-origin** : `javascript_tool` ne peut pas lire son DOM, et l'ouvrir directement dans l'onglet ne marche pas (redirection). On l'observe par captures d'écran, ou côté parent en écoutant les messages `__superdesign`, `location.hash` et le style de `#frame-content`.
- Le MCP chrome-devtools utilise un profil non connecté : inutile pour les artéfacts privés.
- La sortie de `javascript_tool` qui contient des query strings (src de l'iframe…) est masquée : n'afficher que des chemins ou des booléens.
- Entre deux tests, vider `sessionStorage` : sinon l'onglet reste en mode présentation et relance la frame.
- Pour tester, demander à l'utilisateur un lien d'artéfact Claude Design, et demander avant d'ouvrir ses conversations.
