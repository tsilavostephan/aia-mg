CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS colis (
  id BIGSERIAL PRIMARY KEY,
  num_commande TEXT NOT NULL,
  commande_amazon TEXT NOT NULL,
  qte_commande TEXT,
  num_suivi TEXT,
  qte_expediee TEXT,
  nom TEXT,
  transporteur TEXT,
  num_dernier_km TEXT,
  search_text TEXT GENERATED ALWAYS AS (
    lower(num_commande || ' ' || commande_amazon || ' ' || coalesce(qte_commande,'') || ' ' ||
          coalesce(num_suivi,'') || ' ' || coalesce(qte_expediee,'') || ' ' || coalesce(nom,'') || ' ' ||
          coalesce(transporteur,'') || ' ' || coalesce(num_dernier_km,''))
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_colis_order_key ON colis (lower(num_commande), lower(commande_amazon));
CREATE INDEX IF NOT EXISTS idx_colis_num_suivi ON colis (lower(num_suivi));
CREATE INDEX IF NOT EXISTS idx_colis_unresolved_carrier ON colis (transporteur)
  WHERE (num_dernier_km IS NULL OR num_dernier_km = '');
CREATE INDEX IF NOT EXISTS idx_colis_search_trgm ON colis USING GIN (search_text gin_trgm_ops);

-- Horodatage de la 1ère résolution du numéro dernier kilométrique (jamais ré-écrasé tant qu'il
-- reste résolu, voir applyScrapeResults dans lib/db.js) — alimente le tableau de bord de taux de
-- résolution par transporteur/jour/semaine/mois (action 'resolution-stats' dans api/db.js).
ALTER TABLE colis ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Backfill au moment de la migration : pour les colis déjà résolus avant l'ajout de cette colonne,
-- on ne connaît pas la date exacte de résolution — on prend updated_at comme meilleure approximation
-- disponible (ne s'applique qu'une fois, la condition resolved_at IS NULL rend cette étape idempotente).
UPDATE colis SET resolved_at = updated_at
  WHERE resolved_at IS NULL AND num_dernier_km IS NOT NULL AND num_dernier_km <> '';

-- Utilisés par le tableau de bord (GROUP BY transporteur, date_trunc(...) avec un filtre sur une
-- fenêtre récente de created_at/resolved_at, transporteur non filtré) — un index composite avec
-- transporteur en tête de liste n'aiderait pas ce filtre-là, d'où deux index simples.
CREATE INDEX IF NOT EXISTS idx_colis_created_at ON colis (created_at);
CREATE INDEX IF NOT EXISTS idx_colis_resolved_at ON colis (resolved_at) WHERE resolved_at IS NOT NULL;

-- Comptes utilisateurs (remplace le code d'accès unique partagé) : inscription libre, mais un
-- compte reste "pending" (aucun accès à l'appli, voir middleware.js) tant qu'un admin ne lui
-- attribue pas explicitement un rôle depuis le panneau "Comptes" (voir api/users.js). Identifiant
-- de connexion = trigramme (3 lettres), pas un email — format validé côté application
-- (api/register.js), pas par contrainte SQL.
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'pending' CHECK (role IN ('pending','mobile','pc','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

-- Migration depuis l'ancienne colonne "email" (table vide en pratique — aucun compte réel créé
-- avant ce changement) : ADD/DROP COLUMN IF (NOT) EXISTS restent idempotents, contrairement à
-- RENAME COLUMN (pas de variante "IF EXISTS" en Postgres), ce qui casserait un ré-lancement de ce
-- script une fois déjà appliqué.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users DROP COLUMN IF EXISTS email;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
DROP INDEX IF EXISTS idx_users_email_lower;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));

-- Configuration transporteur partagée (remplace le localStorage par navigateur, incohérent dès
-- que plusieurs comptes admin s'y connectent) : algorithmes de recherche, association manuelle
-- transporteur -> valeur brute, case "inclure les colis non résolus des autres transporteurs",
-- délais de scraping (4PX/YANWEN/...). Clé/valeur générique (JSONB) plutôt qu'une colonne par
-- réglage : ces blobs ont chacun leur propre forme et évoluent indépendamment (voir lib/config.js
-- pour la liste des clés utilisées).
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compteur par utilisateur (colis trouvés déjà résolus / recherches totales), alimenté uniquement
-- par les recherches qui aboutissent à exactement un colis via un scan ou un collage (pas par le
-- filtrage au clavier, trop bruyant — voir recordSearchStat dans lib/db.js et son point d'appel
-- unique côté client, applyTrackingTransformIfNeeded/handleRafaleDecode dans assets/script.js et
-- handleDecode dans assets/scan.js). Affiché dans le Tableau de bord (action 'user-search-stats').
CREATE TABLE IF NOT EXISTS user_search_stats (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_searches INT NOT NULL DEFAULT 0,
  found_km INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recherche insensible aux accents, mais UNIQUEMENT sur la colonne Nom (ex. "Stephanie" trouve
-- aussi "Stéphanie") — voir search() dans lib/db.js, qui ajoute une condition supplémentaire par
-- terme portant spécifiquement sur cette expression, en plus du search_text normal (qui, lui,
-- reste sensible aux accents pour les autres colonnes).
--
-- unaccent(text) — la forme à un seul argument — dépend du search_path courant pour résoudre le
-- dictionnaire par défaut et est donc classée STABLE, pas IMMUTABLE : Postgres refuse une fonction
-- STABLE dans une expression d'index. immutable_unaccent() est le contournement standard : appelle
-- explicitement le dictionnaire "unaccent" par nom (forme à 2 arguments), qui ne change jamais en
-- pratique sur une base donnée, et se déclare donc IMMUTABLE. Le nom du dictionnaire ET la fonction
-- unaccent() elle-même doivent être qualifiés par le schéma (public.unaccent(...)) : sans ça,
-- CREATE INDEX échoue avec "function unaccent(regdictionary, text) does not exist" (le search_path
-- résolu au moment de la validation de l'expression d'index diffère de celui d'une requête normale
-- exécutant la même fonction — constaté en pratique sur cette base).
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

CREATE INDEX IF NOT EXISTS idx_colis_nom_unaccent_trgm ON colis
  USING GIN (immutable_unaccent(lower(coalesce(nom, ''))) gin_trgm_ops);
