CREATE TABLE IF NOT EXISTS kollection_saved_collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  nuvio_profile_id INTEGER,
  nuvio_profile_name TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_kollection_saved_collections_user_updated
  ON kollection_saved_collections (user_id, updated_at DESC);
