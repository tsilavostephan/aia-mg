# AIA — Gestionnaire de commandes

Application web (PWA) pour importer des commandes Amazon/logistique depuis des fichiers CSV,
les stocker dans une base de données consultable et recherchable, et automatiser la récupération
du **numéro de suivi dernier kilométrique** auprès de plusieurs transporteurs.

Application 100 % statique (HTML/CSS/JS, sans framework), déployée sur **Vercel**. Les seules
parties « backend » sont quelques fonctions serverless dans `/api` (scraping et authentification).

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
  transporteurs »** (décochée par défaut) : permet à un transporteur donné (typiquement GOFO,
  utilisé comme étape de vérification finale) de tenter aussi sa chance sur les colis d'autres
  transporteurs qui n'ont pas encore de numéro dernier kilométrique. Un colis peut ainsi être
  scrapé par plusieurs transporteurs si besoin.
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
- Export/import de toute la base au format JSON.
- Mode plein écran pour la section base de données (bouton ⛶).

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
  _scrapeLib.js              Fonctions partagées par les fonctions de scraping (Chromium headless, parsing, CORS…)
  scrape-4px.js              Scraping 4PX (bouton "Copy Overview")
  scrape-yanwen.js           Scraping YANWEN (soumission du formulaire + bouton copie)
  scrape-yunexpress.js       Scraping Yun Express (menu "Copy & Export" > "Copy Summary")
  scrape-sfc.js              Scraping SFC (recherche + menu de copie)
  scrape-landmark.js         Scraping LANDMARK (lecture directe du DOM, sans bouton copier)
  scrape-gofo.js             Scraping GOFO (lecture directe du tableau de résultats)

scripts/
  postinstall.mjs            Copie les fichiers Chromium nécessaires au scraping lors du build Vercel

vercel.json                  Configuration des fonctions serverless (durée max, fichiers inclus)
package.json                 Dépendances (puppeteer-core, @sparticuz/chromium-min)
```

---

## Installation et déploiement

Le projet est conçu pour être déployé directement sur **Vercel**, connecté à ce dépôt GitHub.

1. Importer le dépôt sur [vercel.com](https://vercel.com) (aucune configuration de build
   particulière n'est nécessaire, tout est en JavaScript zero-config).
2. Renseigner les [variables d'environnement](#variables-denvironnement) ci-dessous dans
   **Settings → Environment Variables**.
3. Déployer. Le script `postinstall` télécharge et prépare automatiquement les fichiers Chromium
   nécessaires au scraping pendant le build.

En local, l'application peut aussi être ouverte directement en tant que fichier statique
(`index.html`) pour tout ce qui ne dépend pas des fonctions `/api` (import CSV, base de données,
recherche). Les fonctions de scraping et l'authentification nécessitent en revanche un
environnement Vercel (ou `vercel dev`).

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `APP_ACCESS_CODE` | Non (mais recommandé) | Code d'accès à saisir sur la page de connexion. Si absente, l'application reste accessible sans code (pour éviter de se retrouver bloqué dehors par erreur). |
| `APP_AUTH_SECRET` | Non | Secret utilisé pour signer le cookie de session. Si absent, `APP_ACCESS_CODE` est utilisé à la place — il est recommandé d'utiliser une valeur distincte, longue et aléatoire. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Non (mais recommandé) | Ajoutées automatiquement en connectant une base **Vercel KV** depuis l'onglet *Storage* du projet sur vercel.com. Permettent à `api/auth.js` de verrouiller progressivement une adresse IP après plusieurs échecs de connexion (partagé entre toutes les instances/régions). Sans ces variables, un compteur en mémoire local par instance sert de repli — moins robuste (se réinitialise à froid, non partagé entre régions) mais actif par défaut. |

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
4. **Exporter/sauvegarder** : utiliser **Exporter en JSON** pour conserver une copie de la base, ou
   **Importer un JSON** pour la restaurer.

---

## Transporteurs pris en charge

| Transporteur | Import manuel | Scraping automatique |
|---|:---:|:---:|
| 4PX | ✅ | ✅ |
| YANWEN | ✅ | ✅ |
| Yun Express | ✅ | ✅ |
| SFC | ✅ | ✅ |
| LANDMARK | ✅ | ✅ |
| GOFO | ✅ | ✅ |

GOFO peut aussi servir d'étape de vérification finale pour les colis d'autres transporteurs
« dernier kilométrique » (Asendia, China Post, BRT, Spring, Seur, Evri, TNT, Correos, Cainiao,
etc. — liste complète et modifiable via le bouton **⚙ Transporteurs**).

---

## Notes techniques

- **Stockage** : tout est conservé dans le `localStorage` du navigateur (base de commandes,
  configuration des colonnes CSV, algorithmes de recherche, association des transporteurs,
  réglages de scraping). Rien n'est stocké côté serveur en dehors du cookie d'authentification.
- **Scraping** : les fonctions `/api/scrape-*` utilisent `puppeteer-core` avec
  `@sparticuz/chromium-min` (binaire Chromium embarqué au build, pas de téléchargement à
  l'exécution) pour ouvrir réellement les pages de suivi et en extraire les données.
- **PWA** : l'application peut être installée sur mobile/desktop (`manifest.json` + `sw.js`). Le
  service worker met en cache les fichiers statiques pour un usage hors-ligne, mais laisse
  toujours passer les pages HTML par le réseau en premier afin que la vérification du code
  d'accès s'exécute à chaque visite.
