-- Extend effective-dated category target revisions without changing existing
-- monthly targets. Periodic targets have an explicitly selected first due month.
ALTER TABLE category_target_revisions
ADD COLUMN interval_months INTEGER NOT NULL DEFAULT 1
CHECK (interval_months IN (1, 3, 12));

ALTER TABLE category_target_revisions
ADD COLUMN first_due_month TEXT
CHECK (
    first_due_month IS NULL OR (
        first_due_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        AND substr(first_due_month, 1, 4) >= '0001'
        AND CAST(substr(first_due_month, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    )
);
