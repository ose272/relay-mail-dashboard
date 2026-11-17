CREATE TABLE lead_import_batches (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE lead_import_batch_items (
  batch_id TEXT NOT NULL REFERENCES lead_import_batches(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, lead_id)
);

CREATE INDEX idx_lead_import_batch_items_lead
  ON lead_import_batch_items(lead_id, batch_id);

INSERT INTO lead_import_batches (
  id, file_name, created_at, imported_count, duplicate_count, invalid_count
)
SELECT
  'legacy-import',
  'Existing leads (uploads were combined)',
  COALESCE(MIN(created_at), '2026-11-17T00:00:00.000Z'),
  COUNT(*),
  0,
  0
FROM leads
HAVING COUNT(*) > 0;

INSERT INTO lead_import_batch_items (batch_id, lead_id, created_at)
SELECT 'legacy-import', id, created_at
FROM leads
WHERE EXISTS (SELECT 1 FROM lead_import_batches WHERE id = 'legacy-import');
