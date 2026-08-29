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
