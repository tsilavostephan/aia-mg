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
  numéro de suivi, transporteur, nom du destinataire, etc.).
- Bouton **Options** : permet de changer le numéro de colonne associé à chaque champ, avec un
  aperçu en direct basé sur les 100 premières lignes du fichier sélectionné le plus léger.
- Le **Nom** du destinataire est extrait automatiquement de la colonne 7 : le texte entre le
  premier `-` et la virgule qui suit, débarrassé du préfixe `CART'IN` s'il est présent (ex.
  `"RE2336077 - CART'IN Giovany Salomon, AEIC - ..."` → `"Giovany Salomon"`). Un ré-import met à
  jour le Nom avec la nouvelle valeur extraite, sans jamais l'effacer si l'extraction échoue cette
  fois-ci (même protection que le numéro dernier kilométrique).

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
- Raccourci **Alt+↑ / Alt+↓** : passe à l'onglet transporteur précédent/suivant sans toucher la
  souris, pratique pour enchaîner les sessions de scraping manuel transporteur par transporteur.
- Bouton **📊 Tableau de bord** (dans la section « Colis ») : volumes de colis ajoutés et de
  numéros dernier kilométrique résolus par transporteur (ou au total), par jour/semaine/mois —
  utile pour repérer un transporteur qui traîne ou confirmer qu'une session de scraping a porté
  ses fruits.

### 3. Base de données
- Affichage adapté à l'écran : un vrai tableau à colonnes sur desktop (Transporteur, N°
  Commande, Commande Amazon, Qté/Qté expédiée, Num Suivi, Nom, Num dernier km, occupant toute la
  largeur de la fenêtre), et des cartes compactes empilées sur mobile. N° Commande, Commande
  Amazon, Num Suivi et Num dernier km sont copiables en un clic (icône au survol).
- Code transporteur coloré, statut de quantité (correspondance commandée/expédiée en vert/rouge),
  et numéro dernier kilométrique une fois trouvé.
- Recherche par numéro de commande, transporteur ou numéro de suivi, avec :
  - **Scanner un code-barres / QR code** (caméra du téléphone/ordinateur), avec un **mode rafale**
    optionnel : la fiche du colis scanné s'affiche puis se referme toute seule après quelques
    secondes, sans fermer la caméra — pratique pour enchaîner les colis un par un sans re-toucher
    l'écran entre deux scans.
  - **Recherche combinée** : virgule = OU entre plusieurs recherches (ex. « 4PX, YANWEN » renvoie
    l'un ou l'autre), `+` = ET pour combiner des critères sur un même colis (ex.
    « Colissimo + Rasoa » ne renvoie que les colis qui correspondent aux deux à la fois).
  - **Algorithmes de recherche** (bouton ⚙️ à côté du champ) : règles configurables qui
    transforment un numéro collé/scanné (ex. extraction depuis un code-barres) avant de chercher
    une correspondance. Entièrement personnalisable via une fenêtre dédiée (ajout/suppression de
    règles, export/import en XML).
- Recherche et liste paginées côté serveur (boutons Précédent/Suivant) : seule la page affichée est
  chargée, jamais toute la base d'un coup.
- Import CSV et section transporteurs/scraping réservés au rôle **admin** (masqués pour un compte
  **pc**, voir [Comptes utilisateurs et rôles](#4-comptes-utilisateurs-et-rôles)) — pas de code à
  saisir, l'accès dépend uniquement du rôle du compte connecté.
- Export en CSV (en clair) de toute la base — voir section Sauvegarde ci-dessous. Import
  CSV/scraping écrit directement dans Postgres, sans étape d'export manuelle à part.

### 4. Comptes utilisateurs et rôles
- Comptes individuels (trigramme de 3 lettres + mot de passe, `/register.html`) plutôt qu'un code d'accès unique
  partagé. Un compte fraîchement créé reste **en attente** (`/pending.html`) tant qu'un admin ne
  lui attribue pas explicitement un rôle depuis le panneau **👥 Comptes**.
- Trois rôles :
  - **Admin** : accès complet (import CSV, transporteurs/scraping, tableau de bord, recherche,
    export, nettoyage, gestion des comptes).
  - **PC** : tableau de bord, recherche (manuelle + caméra), actualisation, export — pas d'import
    CSV, pas de section transporteurs/scraping, pas de nettoyage.
  - **Mobile** : redirigé vers `/scan.html`, une page dédiée qui n'affiche que la caméra et la
    version — aucun autre accès à l'application. Un scan trouvant une correspondance unique
    affiche directement la fiche du colis.
- Le tout premier compte admin s'amorce via `APP_BOOTSTRAP_ADMIN_TRIGRAM` (voir plus bas) : sans
  cette étape, aucun compte ne pourrait jamais valider le tout premier.
- Le routage par rôle est assuré par un Edge Middleware (`middleware.js`) qui vérifie un cookie de
  session signé (HMAC-SHA256, format JWT-like maison — voir `lib/auth.js`) ; les restrictions plus
  fines par action (ex. `import-batch` réservé à l'admin) sont vérifiées côté serveur dans
  `api/db.js`/`api/scrape.js`, pas seulement masquées côté client.
- Verrouillage progressif par adresse IP en cas d'échecs répétés sur `/api/login` (5 échecs → 30s,
  10 → 5 min, 20 → 30 min), pour limiter les attaques par force brute — voir `KV_REST_API_URL` /
  `KV_REST_API_TOKEN` ci-dessous.

---

## Structure du projet

```
index.html                  Page principale (rôles pc/admin)
scan.html                    Page "Mobile" : caméra + version uniquement (rôle mobile)
login.html                  Page de connexion (trigramme + mot de passe)
register.html                Page d'inscription (compte créé en attente de validation)
pending.html                  Page affichée à un compte en attente de validation
manifest.json, sw.js        Configuration PWA de l'app principale (installation, cache hors-ligne)
manifest-scan.json            Manifeste PWA dédié à scan.html (icône d'installation "AIA Scan" distincte)
middleware.js               Vérifie le cookie de session et route selon le rôle (Edge Middleware)

assets/
  script.js                 Toute la logique de l'app principale (import, base, recherche, transporteurs, scraping…)
  scan.js                    Logique de la page "Mobile" (caméra, recherche, affichage direct du colis)
  styles.css                Feuille de style (app principale)
  *.png                     Logo et icônes PWA

api/
  login.js                   Vérifie trigramme/mot de passe et pose le cookie de session
  register.js                 Crée un compte (rôle "pending", sauf APP_BOOTSTRAP_ADMIN_TRIGRAM)
  session.js                  Renvoie le rôle/trigramme de la session en cours (adapte l'interface au rôle)
  users.js                    Gestion des comptes (admin uniquement) : liste, attribution de rôle, mot de passe
  logout.js                   Efface le cookie de session
  db.js                      Point d'entrée unique vers la base Postgres (recherche, import, scraping, nettoyage, export CSV — voir lib/db.js), avec vérification du rôle par action
  version.js                 Renvoie le numéro de version généré au build (détection de mise à jour)
  scrape.js                  Point d'entrée unique du scraping (admin uniquement) : dispatche vers lib/scrapers/*.js selon le champ "carrier"
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
  db.js                      Accès Postgres (recherche paginée, import/dédoublonnage, application des résultats de scraping, nettoyage, export CSV, tableau de bord)
  users.js                    Comptes utilisateurs (hash/vérification de mot de passe, rôles)
  auth.js                     Jeton de session signé (création/vérification, HMAC-SHA256) — contrepartie Node de middleware.js (Web Crypto)

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
| `APP_AUTH_SECRET` | Oui (recommandé) | Secret utilisé pour signer le cookie de session (HMAC-SHA256). Une valeur longue et aléatoire, distincte de tout mot de passe. Si absent, l'app retombe sur `APP_ACCESS_CODE` (compatibilité) mais un vrai secret dédié est recommandé. |
| `APP_ACCESS_CODE` | Non | Ancien code d'accès unique — n'a plus d'usage direct depuis le passage aux comptes utilisateurs, sauf comme repli pour `APP_AUTH_SECRET` s'il est absent. Peut être retiré une fois `APP_AUTH_SECRET` en place. |
| `APP_BOOTSTRAP_ADMIN_TRIGRAM` | Recommandé | Trigramme qui obtient automatiquement le rôle **admin** à l'inscription (`/register.html`) — amorce le tout premier compte, sans quoi personne ne pourrait jamais valider un compte. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Non (mais recommandé) | Ajoutées automatiquement en connectant une base **Vercel KV** depuis l'onglet *Storage* du projet sur vercel.com. Permettent à `api/login.js`/`api/register.js` de verrouiller progressivement une adresse IP après plusieurs échecs (partagé entre toutes les instances/régions). Sans ces variables, un compteur en mémoire local par instance sert de repli — moins robuste (se réinitialise à froid, non partagé entre régions) mais actif par défaut. |
| `POSTGRES_URL` (ou équivalent) | Oui | Ajoutée automatiquement en connectant une base **Postgres** (Neon) depuis l'onglet *Storage* du projet sur vercel.com. Utilisée par `lib/db.js`/`lib/users.js` pour toute la base (commandes + comptes). |

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
   valider séparément. **📤 Exporter** (rôles pc/admin) télécharge un CSV de toute la base
   (sauvegarde/analyse externe), et les deux boutons **🧹 Nettoyer** (rôle admin uniquement)
   retirent respectivement les colis sans N° Commande/Amazon et les numéros dernier kilométrique
   invalides. Il n'y a volontairement plus de bouton pour effacer toute la base d'un coup (retiré
   après un incident de perte de données).
5. **Gérer les comptes** (admin uniquement) : bouton **👥 Comptes** dans la section "Colis" —
   attribuer un rôle à un compte en attente, changer un rôle existant, ou réinitialiser le mot de
   passe d'un compte.

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
| SF Express | ✅ | ❌ (manuel uniquement) |

> PARCELSAPP a été retiré : le site s'est révélé bloquer systématiquement les sessions automatisées
> sans historique de navigation réel, sans contournement fiable trouvé (voir l'historique git pour
> le détail de ce qui a été tenté).

### SF Express : suivi 100 % manuel

Aucun scraping automatique pour ce transporteur — le site de suivi
([tms.trackmeeasy.com](https://tms.trackmeeasy.com/home)) n'est accessible qu'en s'y connectant
manuellement :
1. Bouton **Copier + Ouvrir** (par lot de 500 numéros) : copie les numéros de suivi dans le
   presse-papier et ouvre le site.
2. Coller les numéros sur le site, lancer la recherche.
3. Copier le tableau de résultats obtenu et le coller dans la zone d'import de l'application (pas
   de limite de longueur, contrairement aux autres transporteurs, le tableau HTML étant beaucoup
   plus volumineux qu'une simple liste de colonnes).
4. Cliquer sur **Importer** : l'application lit la 1ʳᵉ colonne de chaque ligne du tableau (SF
   tracking number) et la 2ᵉ colonne (numéro dernier kilométrique), "Unknown" étant traité comme
   une valeur vide.

### Scraping local WANBEXPRESS en secours

`scripts/local-scrape-worker.js` permet de scraper WANBEXPRESS **depuis votre machine**, en secours
du scraping automatique sur Vercel (qui continue de tourner normalement, et retente aussi ces colis
périodiquement) — utile par exemple après un CAPTCHA intermittent lié à la réputation de l'IP
datacenter Vercel :

```
cp .env.local-worker.example .env.local-worker   # puis remplir APP_BASE_URL, APP_LOGIN_USERNAME et APP_LOGIN_PASSWORD (un compte admin)
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
