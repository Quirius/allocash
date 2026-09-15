-- A move redistributes already-assigned money within a month. It never changes
-- Ready to Assign and remains auditable rather than rewriting assignment input.
CREATE TABLE category_month_moves (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    month TEXT NOT NULL CHECK (
        month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        AND substr(month, 1, 4) >= '0001'
        AND CAST(substr(month, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    ),
    from_category_id TEXT NOT NULL REFERENCES categories(id),
    to_category_id TEXT NOT NULL REFERENCES categories(id),
    amount_huf INTEGER NOT NULL CHECK (amount_huf > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (from_category_id <> to_category_id)
) STRICT;
CREATE INDEX category_month_moves_month ON category_month_moves(month, from_category_id, to_category_id);
