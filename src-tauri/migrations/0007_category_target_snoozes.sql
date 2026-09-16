-- Snoozing is month-specific advisory state. It never changes a target revision
-- or any assigned/available budget money.
CREATE TABLE category_target_snoozes (
    category_id TEXT NOT NULL REFERENCES categories(id),
    month TEXT NOT NULL CHECK (
        month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        AND substr(month, 1, 4) >= '0001'
        AND CAST(substr(month, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (category_id, month)
) STRICT;

CREATE INDEX category_target_snoozes_month ON category_target_snoozes(month, category_id);
