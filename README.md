# Super CDesign

**Super Claude Design** : une extension Chrome pour présenter un design fait avec Claude sans l'interface de Claude, et le tester sur un vrai téléphone en scannant un QR code.

> ⚠️ **Fonctionne uniquement avec la version web de Claude** ([claude.ai](https://claude.ai) dans Chrome). L'application de bureau Claude (Mac / Windows) et les applications mobiles ne chargent pas les extensions Chrome.

> Projet personnel, non officiel, sans lien avec Anthropic. Il s'appuie sur l'interface actuelle de claude.ai et peut cesser de fonctionner si elle change.

## Pourquoi

Depuis que Claude Design s'affiche dans les artéfacts, présenter un site à un client montre aussi les barres de Claude (en-tête, barre du viewer, « Fill / Fit »…). Et les simulateurs de téléphone ne remplacent pas un test sur un vrai téléphone.

## Fonctionnalités

### Présenter sans l'interface Claude
- **Bouton « Présenter »** dans l'en-tête du panneau d'artéfact (à côté de Partager / Développer) : ouvre l'artéfact publié dans un nouvel onglet, en plein écran, **sans aucune barre de Claude**.
- **« Play new tab »** dans le menu **PLAY** de chaque frame du canvas (à côté de « Play on canvas » et « Play full screen ») : ouvre directement cette frame en plein écran dans un nouvel onglet, sans interface.

Le bouton et l'option n'apparaissent que pour un artéfact **publié** (il faut un lien `claude.ai/artifact/…`).

### Preview mobile sur un vrai téléphone
- Un **petit serveur local** sert sur ton Wi-Fi les exports HTML de tes designs.
- Le **bouton téléphone** dans l'en-tête du panneau d'artéfact affiche son **QR code** : scanne-le avec l'appareil photo du téléphone.
- Sur le téléphone, l'accueil montre **tes projets avec un aperçu de chaque page** ; touche une page pour l'ouvrir en plein écran.
- **Les liens entre pages fonctionnent** quand les pages sont dans le même projet.
- Quand tu remplaces un export, **le téléphone se recharge tout seul**.

Rien n'est automatisé dans Claude : c'est toi qui exportes, avec le bouton natif. Le serveur ne fait que lire un dossier sur ton ordinateur, et rien ne sort de ton réseau local.

## Installation

### 1. L'extension

1. Télécharge ce dépôt (`git clone` ou **Code → Download ZIP**, puis décompresse).
2. Ouvre `chrome://extensions` dans Chrome.
3. Active le **Mode développeur** (en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et choisis le dossier du dépôt (celui qui contient `manifest.json`).
5. Recharge tes onglets claude.ai.

### 2. Le serveur de preview mobile (facultatif)

Il faut [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
cd server
npm install
npm start
```

Le terminal affiche l'adresse du serveur (par ex. `http://192.168.1.20:4321/`) et le dossier surveillé, `~/SuperDesign` par défaut. Laisse le terminal ouvert.

- Pour surveiller un autre dossier : `SUPERDESIGN_DIR=/chemin/vers/dossier npm start`.
- Pour changer de port : `PORT=5000 npm start` (le bouton de l'extension attend le port 4321).
- Au premier lancement, macOS peut demander d'autoriser les connexions entrantes pour `node` : accepte, c'est ce qui permet au téléphone de joindre l'ordinateur.

Le serveur tourne sur macOS et Linux (il utilise la commande `unzip`).

## Utilisation de la preview mobile

1. Dans Claude Design, sur la frame voulue : **⬇ Export this artboard → HTML (.zip)**, puis enregistre le fichier.
2. Dépose le zip dans `~/SuperDesign` :
   - un zip à la racine = un projet d'une page ;
   - **un sous-dossier = un projet de plusieurs pages** (par ex. `~/SuperDesign/MonSite/` avec l'export de l'accueil, de la boutique, du paiement…). Les pages y sont réunies : les liens entre elles fonctionnent.
3. Clique sur le **bouton téléphone** dans l'en-tête du panneau d'artéfact et scanne le QR code. Le téléphone doit être sur **le même Wi-Fi** que l'ordinateur.
4. Pour mettre à jour : réexporte la frame et remplace le zip dans le dossier. La page ouverte sur le téléphone se recharge seule.

Un lien vers une page pas encore exportée affiche un écran d'explication, qui se met à jour dès que le zip arrive.

## Comment ça marche

- `content.js` tourne sur claude.ai et dans l'iframe du viewer de Claude Design. Il ajoute les boutons, masque les barres de Claude dans l'onglet de présentation et ajoute « Play new tab » au menu PLAY. Les deux contextes communiquent par `postMessage` (origines vérifiées).
- `background.js` récupère le QR code auprès du serveur local : seul le service worker de l'extension peut joindre `localhost` depuis claude.ai.
- `server/server.mjs` surveille le dossier, décompresse les exports, ajoute la balise `viewport` qui manque aux exports (sinon le téléphone affiche la version ordinateur rétrécie), et injecte un petit script de rechargement automatique.

Les détails techniques, et les pièges de l'interface de Claude, sont dans [`CLAUDE.md`](CLAUDE.md).

## Limites

- Version web de claude.ai dans Chrome uniquement (ou un navigateur Chromium qui accepte les extensions non empaquetées).
- Dépend de l'interface actuelle de Claude : si Anthropic la modifie, les boutons ou « Play new tab » peuvent disparaître jusqu'à une mise à jour.
- La preview mobile ne fonctionne que sur le réseau local, et seulement pendant que le serveur tourne.
- Les exports sont des copies : après une modification du design, il faut réexporter.
