# Installer Super CDesign — guide pour les assistants IA

Ce guide s'adresse à un assistant IA (Claude, ChatGPT, Claude Code, Codex, Cursor…) qui installe **Super CDesign** pour un utilisateur. Suis-le dans l'ordre. Parle à l'utilisateur dans sa langue, avec des phrases simples.

**Super CDesign** (Super Claude Design) est une extension Chrome pour la **version web** de Claude (claude.ai), plus un petit serveur local facultatif :
- l'extension présente un design Claude sans l'interface de Claude (bouton « Présenter », option « Play new tab ») ;
- le serveur (`server/`) sert sur le Wi-Fi les exports HTML de Claude Design, pour les ouvrir sur un vrai téléphone par QR code.

Dépôt : https://github.com/theolg29/super-cdesign

---

## Règles pour l'assistant

1. **Demande d'abord où installer** (étape 1) et attends la réponse. N'exécute aucune commande avant.
2. **Tu peux exécuter des commandes** (Claude Code, Codex, Cursor…) : lance-les toi-même, une étape à la fois, et vérifie chaque résultat avant de passer à la suite.
3. **Tu ne peux pas exécuter de commandes** (Claude ou ChatGPT dans le navigateur) : donne à l'utilisateur **une seule étape à la fois**, avec la commande exacte à copier, et demande-lui de te coller le résultat avant de continuer.
4. Le chargement de l'extension dans Chrome (étape 5) se fait **toujours à la main** par l'utilisateur : aucun outil ne peut ouvrir `chrome://extensions` à sa place. Guide-le clic par clic.
5. Aucun compte, mot de passe, clé d'API ni jeton n'est nécessaire. N'en demande pas, et ne modifie aucun réglage de claude.ai ni de Chrome en dehors des étapes ci-dessous.
6. En cas d'erreur, explique-la simplement et propose la correction. Ne contourne pas une protection du système (pare-feu, droits d'administrateur) sans l'accord explicite de l'utilisateur.

---

## Étape 1 — Demander le lieu d'installation (obligatoire)

Pose ces deux questions à l'utilisateur, puis attends ses réponses :

1. **Dans quel dossier veux-tu installer Super CDesign ?**
   Propose un défaut, par exemple `~/Documents/super-cdesign` (macOS, Linux) ou `C:\Users\<nom>\Documents\super-cdesign` (Windows). Le dépôt sera cloné **dans** ce dossier : il ne doit pas déjà exister, ou doit être vide.
2. **Veux-tu aussi la preview mobile** (le serveur local qui affiche tes designs sur ton téléphone) ? Elle demande Node.js. Si la réponse est non, saute les étapes 4 et 6.

Retiens le chemin choisi : on l'appelle `<DOSSIER>` dans la suite. Utilise toujours son **chemin absolu** dans les commandes et dans les explications.

## Étape 2 — Vérifier les prérequis

- **Google Chrome** (ou un navigateur Chromium qui accepte les extensions non empaquetées : Brave, Edge, Arc…) sur ordinateur.
- **git** : `git --version`. S'il manque, l'utilisateur peut télécharger le ZIP du dépôt à la place (bouton **Code → Download ZIP** sur GitHub) et le décompresser dans `<DOSSIER>`.
- **Node.js 18 ou plus**, seulement pour la preview mobile : `node --version`. S'il manque ou s'il est trop ancien, indique https://nodejs.org (version LTS) et attends que l'utilisateur l'ait installé.

Rappelle à l'utilisateur que l'extension ne fonctionne **qu'avec la version web de Claude** (claude.ai dans Chrome), pas avec l'application de bureau Claude ni les applications mobiles.

## Étape 3 — Récupérer le projet

```bash
git clone https://github.com/theolg29/super-cdesign.git "<DOSSIER>"
```

Vérifie que `<DOSSIER>/manifest.json` existe.

## Étape 4 — Installer le serveur de preview mobile (si demandé)

```bash
cd "<DOSSIER>/server"
npm install
```

Le serveur utilise la commande `unzip` (macOS, Linux) ou, à défaut, `tar` (Windows 10 et plus récent).

## Étape 5 — Charger l'extension dans Chrome (l'utilisateur le fait)

Donne ces instructions à l'utilisateur, avec le chemin absolu de `<DOSSIER>` :

1. Ouvrir `chrome://extensions` dans la barre d'adresse de Chrome.
2. Activer le **Mode développeur** (interrupteur en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et choisir le dossier `<DOSSIER>`, celui qui contient `manifest.json`.
4. Vérifier que **Super CDesign** apparaît dans la liste, activée.
5. Recharger les onglets claude.ai déjà ouverts.

Demande-lui de confirmer que l'extension apparaît bien.

## Étape 6 — Lancer le serveur et tester (si la preview mobile est installée)

```bash
cd "<DOSSIER>/server"
npm start
```

- Le serveur doit rester lancé : si tu exécutes les commandes toi-même, lance-le en arrière-plan ou dans un terminal séparé, puis vérifie qu'il répond :
  ```bash
  curl -s http://localhost:4321/api/qr
  ```
  La réponse est un JSON avec `url` (normalement `http://cdesign.local/`), `ipUrl` (l'adresse IP de secours) et `dir` (le dossier surveillé).
- Le terminal affiche l'adresse du serveur, `http://cdesign.local/` (annoncée sur le Wi-Fi par Bonjour / mDNS, avec l'adresse IP en secours), et le dossier surveillé : `<DOSSIER>/super-cdesign-exports/`, créé automatiquement.
- Si un téléphone Android n'ouvre pas `cdesign.local`, il faut utiliser l'adresse IP affichée en secours.
- Au premier lancement, macOS (ou le pare-feu Windows) peut demander d'autoriser les connexions entrantes pour `node` : l'utilisateur doit accepter, sinon le téléphone ne pourra pas joindre l'ordinateur.

Explique ensuite à l'utilisateur comment s'en servir :

1. Dans Claude Design, sur une frame : **⬇ Export this artboard → HTML (.zip)**, puis enregistrer le fichier.
2. Déposer le zip dans `<DOSSIER>/super-cdesign-exports/`. Un sous-dossier, par exemple `super-cdesign-exports/MonSite/`, regroupe plusieurs pages d'un même site : les liens entre elles fonctionnent.
3. Dans claude.ai, cliquer sur le **bouton téléphone** dans l'en-tête du panneau d'artéfact, puis scanner le QR code avec le téléphone, connecté au **même Wi-Fi**.
4. Pour mettre à jour : réexporter et remplacer le zip. Le téléphone se recharge tout seul.

Pour les prochaines fois, l'utilisateur relance le serveur avec `cd "<DOSSIER>/server" && npm start`.

## Étape 7 — Résumé final

Termine par un court résumé : le chemin d'installation, ce qui est installé (extension, et serveur si demandé), comment lancer le serveur, et où déposer les exports.

---

## Mettre à jour

```bash
cd "<DOSSIER>"
git pull
cd server && npm install
```

Puis dans `chrome://extensions`, cliquer sur ↻ sur Super CDesign, et relancer le serveur s'il tournait.

## Désinstaller

1. Dans `chrome://extensions`, cliquer sur **Supprimer** sur Super CDesign.
2. Arrêter le serveur (Ctrl+C dans son terminal).
3. Supprimer `<DOSSIER>`, **après avoir demandé à l'utilisateur** s'il veut garder ses exports (`<DOSSIER>/super-cdesign-exports/`).
