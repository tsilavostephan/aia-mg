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
