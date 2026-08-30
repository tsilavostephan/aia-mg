# AIA — Gestionnaire de commandes

Application web (PWA) pour importer des commandes Amazon/logistique depuis des fichiers CSV,
les stocker dans une base de données consultable et recherchable, et automatiser la récupération
du **numéro de suivi dernier kilométrique** auprès de plusieurs transporteurs.

Frontend 100 % statique (HTML/CSS/JS, sans framework), déployé sur **Vercel**, avec quelques
fonctions serverless dans `/api` (scraping, authentification, accès à la base). La base de
commandes elle-même vit dans **Vercel Postgres** (voir `lib/db.js`/`api/db.js`) — plus dans le
navigateur ni dans un fichier chiffré sur Vercel Blob, pour pouvoir tenir jusqu'à ~1 million de
commandes sans ralentissement.

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Structure du projet](#structure-du-projet)
3. [Installation et déploiement](#installation-et-déploiement)
4. [Variables d'environnement](#variables-denvironnement)
5. [Utilisation](#utilisation)
6. [Transporteurs pris en charge](#transporteurs-pris-en-charge)
7. [Notes techniques](#notes-techniques)

---

## Fonctionnalités

### 1. Import CSV
- Glisser-déposer ou sélection de plusieurs fichiers CSV à la fois.
- Chaque ligne est mappée vers un enregistrement de commande (numéro de commande, quantité,
  numéro de suivi, transporteur, etc.).
- Bouton **Options** : permet de changer le numéro de colonne associé à chaque champ, avec un
  aperçu en direct basé sur les 100 premières lignes du fichier sélectionné le plus léger.

### 2. Détection du LastMile Tracking Number (suivi par transporteur)
- Les commandes importées sont automatiquement regroupées par transporteur.
- Pour chaque transporteur : génération d'un ou plusieurs liens de suivi groupés (les numéros
  sont répartis par lots de 99 pour éviter les limites des sites de suivi), avec un bouton
  **Ouvrir** et un bouton **Afficher** (aperçu du lien/texte à copier dans une fenêtre modale).
- **Import manuel** : zone pour coller les données copiées depuis la page de suivi du
  transporteur, puis bouton **Importer** pour associer automatiquement le numéro dernier
  kilométrique à chaque commande.
- **Scraping automatique** (« Scrapping (Vercel) ») : pour les transporteurs pris en charge, une
  fonction backend ouvre elle-même la page de suivi dans un navigateur headless, récupère les
  données et les enregistre directement dans la base — sans copier-coller manuel.
- Bouton **Tout récupérer** : lance le scraping automatique pour tous les transporteurs éligibles
  en même temps, avec barre de progression (verte si tout s'est bien passé, rouge sinon).
- Case à cocher **« Inclure aussi les colis sans numéro dernier kilométrique des autres
  transporteurs »** (décochée par défaut) : permet à un transporteur donné de servir d'étape de
  vérification finale en tentant aussi sa chance sur les colis d'autres transporteurs qui n'ont pas
  encore de numéro dernier kilométrique. Un colis peut ainsi être scrapé par plusieurs
  transporteurs si besoin.
- Bouton **⚙ Transporteurs** : fenêtre listant toutes les valeurs brutes de la colonne
  « transporteur » trouvées dans la base, avec des cases à cocher pour forcer manuellement leur
  association à un transporteur connu (utile si l'orthographe exacte dans les CSV ne correspond
  à aucun transporteur reconnu automatiquement). Sauvegardé dans le navigateur (localStorage).

### 3. Base de données
- Liste des commandes sous forme de cartes, avec code transporteur coloré, statut de quantité
  (correspondance commandée/expédiée), et numéro dernier kilométrique une fois trouvé.
- Recherche par numéro de commande, transporteur ou numéro de suivi, avec :
  - **Scanner un code-barres / QR code** (caméra du téléphone/ordinateur).
  - **Algorithmes de recherche** (bouton ⚙️ à côté du champ) : règles configurables qui
    transforment un numéro collé/scanné (ex. extraction depuis un code-barres) avant de chercher
    une correspondance. Entièrement personnalisable via une fenêtre dédiée (ajout/suppression de
    règles, export/import en XML).
- Recherche et liste paginées côté serveur (boutons Précédent/Suivant) : seule la page affichée est
  chargée, jamais toute la base d'un coup.
- Verrouillé par défaut à la connexion : seule cette section est visible, export/nettoyage/suppression
  désactivés. Alt+T (ou le bouton 🔒) déverrouille tout avec un code dédié, pour la session.
- Export en CSV (en clair) de toute la base — voir section Sauvegarde ci-dessous. Import
  CSV/scraping écrit directement dans Postgres, sans étape d'export manuelle à part.

### 4. Authentification
- L'ensemble du site (pages et API) est protégé par un **code d'accès** unique, vérifié par un
  middleware Vercel (Edge Middleware). Une fois le bon code saisi sur `/login.html`, un cookie
  signé autorise l'accès pendant 30 jours. Lien **Se déconnecter** dans l'en-tête de l'app.
- Verrouillage progressif par adresse IP en cas d'échecs répétés sur `/api/auth` (5 échecs → 30s,
  10 → 5 min, 20 → 30 min), pour limiter les attaques par force brute — voir `KV_REST_API_URL` /
  `KV_REST_API_TOKEN` ci-dessous.

---

## Structure du projet

```
index.html                  Page principale de l'application
login.html                  Page de connexion (code d'accès)
manifest.json, sw.js        Configuration PWA (installation, cache hors-ligne)
middleware.js               Vérifie le cookie d'authentification sur chaque requête (Edge Middleware)

assets/
  script.js                 Toute la logique de l'application (import, base, recherche, transporteurs, scraping…)
  styles.css                Feuille de style
  *.png                     Logo et icônes PWA

api/
  auth.js                   Vérifie le code d'accès et pose le cookie de session
  logout.js                 Efface le cookie de session
  login-code.js              Renvoie le code d'accès à une session déjà connectée
  db.js                      Point d'entrée unique vers la base Postgres (recherche, import, scraping, nettoyage, export CSV — voir lib/db.js)
  version.js                 Renvoie le numéro de version généré au build (détection de mise à jour)
  scrape.js                  Point d'entrée unique du scraping : dispatche vers lib/scrapers/*.js selon le champ "carrier"
  _scrapeLib.js              Fonctions partagées par les fonctions de scraping (Chromium headless, parsing, CORS…)
  _rateLimit.js              Verrouillage progressif par IP après des échecs de connexion répétés (KV/Upstash ou repli en mémoire)
  _stealthScrapeLib.js        Lancement de navigateur "furtif" (puppeteer-extra-plugin-stealth) pour les sites avec détection anti-bot

lib/scrapers/                Un module par transporteur (hors de /api : pas compté dans la limite de 12
                              fonctions serverless du plan Vercel Hobby), tous appelés via api/scrape.js
  4px.js                     Scraping 4PX officiel (clic sur chaque colis de la liste)
  cainiao.js                 Scraping CAINIAO (bouton "Copy Overview")
  yanwen.js                  Scraping YANWEN (soumission du formulaire + bouton copie)
  yunexpress.js              Scraping Yun Express (menu "Copy & Export" > "Copy Summary")
  sfc.js                     Scraping SFC (recherche + menu de copie)
  landmark.js                Scraping LANDMARK (lecture directe du DOM, sans bouton copier)
  topyou.js                  Scraping TopYou (éditeur CodeMirror + lecture directe du DOM)
  cne.js                     Scraping CNE (un lien par colis, lecture directe du DOM)
  sunyou.js                  Scraping Sunyou (bouton copie détaillé, fenêtre desktop large)
  wanbexpress.js             Scraping WANBEXPRESS (un lien par colis, navigateur furtif, via packageradar.com)

lib/
  db.js                      Accès Postgres (recherche paginée, import/dédoublonnage, application des résultats de scraping, nettoyage, export CSV)

scripts/
  postinstall.mjs            Copie les fichiers Chromium nécessaires au scraping lors du build Vercel
  generate-version.mjs       Génère le numéro de version et tamponne le service worker à chaque build
  schema.sql                 Schéma Postgres (table colis, index de recherche/dédoublonnage)
  migrate.mjs                Applique schema.sql contre la base Postgres configurée (à lancer une fois)

vercel.json                  Configuration des fonctions serverless (durée max, fichiers inclus)
package.json                 Dépendances (puppeteer-core, @sparticuz/chromium-min, @vercel/postgres)
```

---

## Installation et déploiement

Le projet est conçu pour être déployé directement sur **Vercel**, connecté à ce dépôt GitHub.

1. Importer le dépôt sur [vercel.com](https://vercel.com) (aucune configuration de build
   particulière n'est nécessaire, tout est en JavaScript zero-config).
2. Ajouter une base **Postgres** (Neon) depuis l'onglet *Storage* du projet — les variables
   `POSTGRES_URL`/`DATABASE_URL` sont injectées automatiquement.
3. Exécuter une fois le schéma (`scripts/schema.sql`) dans cette base : en local, `vercel env pull
   .env --environment=preview --git-branch=test` (les variables Postgres ne sont pas dans
   l'environnement Development par défaut) puis `node --env-file=.env scripts/migrate.mjs`.
4. Renseigner les autres [variables d'environnement](#variables-denvironnement) ci-dessous dans
   **Settings → Environment Variables**.
5. Déployer. Le script `postinstall` télécharge et prépare automatiquement les fichiers Chromium
   nécessaires au scraping pendant le build.

Les fonctions de scraping, l'authentification et l'accès à la base (`/api/db`) nécessitent un
environnement Vercel (ou `vercel dev`) — l'application ne fonctionne pas ouverte en simple fichier
statique.

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `APP_ACCESS_CODE` | Non (mais recommandé) | Code d'accès à saisir sur la page de connexion. Si absente, l'application reste accessible sans code (pour éviter de se retrouver bloqué dehors par erreur). |
| `APP_AUTH_SECRET` | Non | Secret utilisé pour signer le cookie de session. Si absent, `APP_ACCESS_CODE` est utilisé à la place — il est recommandé d'utiliser une valeur distincte, longue et aléatoire. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Non (mais recommandé) | Ajoutées automatiquement en connectant une base **Vercel KV** depuis l'onglet *Storage* du projet sur vercel.com. Permettent à `api/auth.js` de verrouiller progressivement une adresse IP après plusieurs échecs de connexion (partagé entre toutes les instances/régions). Sans ces variables, un compteur en mémoire local par instance sert de repli — moins robuste (se réinitialise à froid, non partagé entre régions) mais actif par défaut. |
| `POSTGRES_URL` (ou équivalent) | Oui | Ajoutée automatiquement en connectant une base **Postgres** (Neon) depuis l'onglet *Storage* du projet sur vercel.com. Utilisée par `lib/db.js` pour toute la base de commandes. |
| `APP_EXPORT_CODE` | Oui, pour Exporter/Nettoyer | Code demandé pour déverrouiller ces actions (distinct du code de connexion). Sans cette variable, elles échouent avec un message explicite plutôt que d'accepter n'importe quel code. |

Aucune autre variable n'est nécessaire : les fonctions de scraping n'utilisent pas de clé API
externe (elles pilotent un navigateur headless directement).

---

## Utilisation

1. **Importer des commandes** : déposer un ou plusieurs fichiers CSV dans la section 1. Vérifier
   les colonnes via le bouton **Options** si besoin, puis cliquer sur **Ajouter à la base de
   données**.
2. **Récupérer les numéros dernier kilométrique** : dans la section 2, choisir un onglet
   transporteur puis soit :
   - cliquer sur **Ouvrir** pour consulter le site du transporteur manuellement, copier les
     résultats et les coller dans la zone prévue avant de cliquer sur **Importer** ;
   - cliquer sur **Scrapping (Vercel)** pour laisser l'application le faire automatiquement (si
     disponible pour ce transporteur) ;
   - ou cliquer sur **Tout récupérer** en haut de la section pour lancer le scraping sur tous les
     transporteurs éligibles d'un coup.
3. **Rechercher une commande** : utiliser le champ de recherche de la section 3 (scan possible via
   l'icône caméra), ou parcourir/filtrer la liste des commandes.
4. **Sauvegarder** : chaque import/scraping/nettoyage écrit déjà directement dans Postgres — rien à
   valider séparément. Alt+T pour déverrouiller (les boutons de nettoyage restent masqués tant que
   ce n'est pas fait), puis **📤 Exporter** télécharge un CSV de toute la base (sauvegarde/analyse
   externe), et les deux boutons **🧹 Nettoyer** retirent respectivement les colis sans N° Commande/
   Amazon et les numéros dernier kilométrique invalides. Il n'y a volontairement plus de bouton pour
   effacer toute la base d'un coup (retiré après un incident de perte de données).

---

## Transporteurs pris en charge

| Transporteur | Import manuel | Scraping automatique |
|---|:---:|:---:|
| 4PX | ✅ | ✅ |
| CAINIAO | ✅ | ✅ |
| YANWEN | ✅ | ✅ |
| Yun Express | ✅ | ✅ |
| SFC | ✅ | ✅ |
| LANDMARK | ✅ | ✅ |
| TopYou | ✅ | ✅ |
| CNE | ✅ | ✅ |
| Sunyou | ✅ | ✅ |

> PARCELSAPP a été retiré : le site s'est révélé bloquer systématiquement les sessions automatisées
> sans historique de navigation réel, sans contournement fiable trouvé (voir l'historique git pour
> le détail de ce qui a été tenté).

### Scraping local WANBEXPRESS en secours

`scripts/local-scrape-worker.js` permet de scraper WANBEXPRESS **depuis votre machine**, en secours
du scraping automatique sur Vercel (qui continue de tourner normalement, et retente aussi ces colis
périodiquement) — utile par exemple après un CAPTCHA intermittent lié à la réputation de l'IP
datacenter Vercel :

```
cp .env.local-worker.example .env.local-worker   # puis remplir APP_BASE_URL et APP_ACCESS_CODE
node --env-file=.env.local-worker scripts/local-scrape-worker.js
```

Lancement manuel uniquement (pas un service en continu) — ne traite que les colis WANBEXPRESS encore
non résolus au moment où vous le lancez, écrit directement les résultats trouvés en base via
`/api/db`, puis se termine. Voir `.env.local-worker.example` pour les options (concurrence, délai
d'attente par page).

N'importe lequel de ces transporteurs peut aussi servir d'étape de vérification finale pour les
colis d'autres transporteurs (case à cocher « Inclure aussi les colis sans numéro dernier
kilométrique des autres transporteurs », voir section 2 ci-dessus) — et de nouvelles valeurs de
transporteur brutes trouvées dans les CSV peuvent être associées manuellement à l'un de ces
transporteurs connus via le bouton **⚙ Transporteurs**.

---

## Notes techniques

- **Stockage** : la base de commandes vit dans **Vercel Postgres** (`lib/db.js`), interrogée par
  page (recherche paginée, jamais tout chargé en mémoire). Seules les préférences d'interface
  (configuration des colonnes CSV, algorithmes de recherche, association des transporteurs,
  réglages de scraping) restent dans le `localStorage` du navigateur.
- **Scraping** : les fonctions `/api/scrape-*` utilisent `puppeteer-core` avec
  `@sparticuz/chromium-min` (binaire Chromium embarqué au build, pas de téléchargement à
  l'exécution) pour ouvrir réellement les pages de suivi et en extraire les données.
- **PWA** : l'application peut être installée sur mobile/desktop (`manifest.json` + `sw.js`). Le
  service worker met en cache les fichiers statiques pour un usage hors-ligne, mais laisse
  toujours passer les pages HTML par le réseau en premier afin que la vérification du code
  d'accès s'exécute à chaque visite.
