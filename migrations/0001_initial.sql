CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (
  day TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('selecting','pending','sent','failed','uncertain','skipped')),
  image_id TEXT,
  family TEXT,
  image_url TEXT,
  image_json TEXT,
  nonce TEXT,
  message_id TEXT,
  note TEXT,
  updated TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS used_family ON deliveries(family)
  WHERE status IN ('pending','uncertain','sent');
CREATE UNIQUE INDEX IF NOT EXISTS used_image ON deliveries(image_url)
  WHERE status IN ('pending','uncertain','sent');
CREATE INDEX IF NOT EXISTS delivery_status ON deliveries(status);
CREATE TABLE IF NOT EXISTS rejected_images (
  image_id TEXT PRIMARY KEY, reason TEXT NOT NULL,
  updated TEXT NOT NULL DEFAULT (datetime('now'))
);
