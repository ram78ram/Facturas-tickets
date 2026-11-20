DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store TEXT NOT NULL,
  ticket_date TEXT NOT NULL,
  folio TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',
  invoice_folio TEXT,
  invoice_date TEXT,
  code TEXT,
  note TEXT,
  is_gasoline INTEGER NOT NULL DEFAULT 1,
  photo_blob_key TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE fiscal_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rfc TEXT NOT NULL,
  regime TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE portals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  username TEXT,
  note TEXT
);
