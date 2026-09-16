-- Target revisions are effective-dated so editing a future target never changes
-- historical Plan guidance. An inactive revision is a tombstone.
CREATE TABLE category_target_revisions (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    category_id TEXT NOT NULL REFERENCES categories(id),
    effective_month TEXT NOT NULL CHECK (
        effective_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        AND substr(effective_month, 1, 4) >= '0001'
        AND CAST(substr(effective_month, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    ),
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    behavior TEXT CHECK (behavior IN ('set_aside', 'refill')),
    amount_huf INTEGER,
    due_kind TEXT CHECK (due_kind IN ('day', 'last_day')),
    due_day INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (category_id, effective_month),
    CHECK (
        (active = 0 AND behavior IS NULL AND amount_huf IS NULL AND due_kind IS NULL AND due_day IS NULL)
        OR
        (active = 1 AND behavior IN ('set_aside', 'refill') AND amount_huf > 0
         AND ((due_kind = 'day' AND due_day BETWEEN 1 AND 31) OR (due_kind = 'last_day' AND due_day IS NULL)))
    )
) STRICT;

CREATE INDEX category_target_revisions_effective_month
ON category_target_revisions(category_id, effective_month);
