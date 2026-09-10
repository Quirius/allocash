-- Initial foundation only. Ledger tables arrive in the next migration.
CREATE TABLE budget_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    currency TEXT NOT NULL CHECK (currency = 'HUF')
) STRICT;

INSERT INTO budget_settings (id, name, currency)
VALUES (1, 'My budget', 'HUF');
