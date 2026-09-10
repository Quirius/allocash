CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    kind TEXT NOT NULL CHECK (kind IN ('cash', 'credit', 'loan', 'tracking')),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE category_groups (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))
) STRICT;

CREATE TABLE categories (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    group_id TEXT NOT NULL REFERENCES category_groups(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    notes TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE payees (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    last_category_id TEXT REFERENCES categories(id),
    last_direction TEXT CHECK (last_direction IN ('inflow', 'outflow')),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
) STRICT;

CREATE TABLE flags (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL UNIQUE CHECK (color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple')),
    sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 5)
) STRICT;
INSERT INTO flags (id, name, color, sort_order) VALUES
    ('flag-red', 'Unknown problem...', 'red', 0),
    ('flag-orange', 'Correction', 'orange', 1),
    ('flag-yellow', 'Check', 'yellow', 2),
    ('flag-green', '', 'green', 3),
    ('flag-blue', '', 'blue', 4),
    ('flag-purple', 'WTH is this??', 'purple', 5);

-- Import staging preserves complete archives and individual source rows.
-- Parsing, hashing and cross-export duplicate detection belong to the importer.
CREATE TABLE import_batches (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    source_name TEXT NOT NULL,
    source_bytes BLOB NOT NULL,
    sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE import_rows (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    batch_id TEXT NOT NULL REFERENCES import_batches(id),
    source_file TEXT NOT NULL,
    row_number INTEGER NOT NULL CHECK (row_number > 0),
    raw_data TEXT NOT NULL,
    UNIQUE (batch_id, source_file, row_number)
) STRICT;

-- Deferred, circular FKs require exactly two matching legs at COMMIT.
-- The shared positive amount is stored once; ledger_entries derives both signs.
CREATE TABLE transfers (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    amount_huf INTEGER NOT NULL CHECK (amount_huf > 0),
    outflow_id TEXT NOT NULL UNIQUE,
    inflow_id TEXT NOT NULL UNIQUE CHECK (inflow_id <> outflow_id),
    outflow_direction TEXT NOT NULL DEFAULT 'outflow' CHECK (outflow_direction = 'outflow'),
    inflow_direction TEXT NOT NULL DEFAULT 'inflow' CHECK (inflow_direction = 'inflow'),
    FOREIGN KEY (outflow_id, id, outflow_direction)
        REFERENCES transactions(id, transfer_id, transfer_direction) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (inflow_id, id, inflow_direction)
        REFERENCES transactions(id, transfer_id, transfer_direction) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    transaction_date TEXT NOT NULL CHECK (
        transaction_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND substr(transaction_date, 1, 4) >= '0001'
        AND date(transaction_date, '+0 days') IS NOT NULL
        AND date(transaction_date, '+0 days') = transaction_date
    ),
    payee_id TEXT REFERENCES payees(id),
    category_id TEXT REFERENCES categories(id),
    memo TEXT NOT NULL DEFAULT '',
    flag_id TEXT REFERENCES flags(id),
    amount_huf INTEGER,
    cleared_state TEXT NOT NULL DEFAULT 'cleared'
        CHECK (cleared_state IN ('uncleared', 'cleared', 'reconciled')),
    posting_state TEXT NOT NULL DEFAULT 'posted' CHECK (posting_state IN ('posted', 'scheduled')),
    origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'import', 'schedule')),
    -- Opaque provenance until recurrence definitions are introduced in a later migration.
    scheduled_origin_id TEXT,
    import_row_id TEXT UNIQUE REFERENCES import_rows(id),
    transfer_id TEXT REFERENCES transfers(id) DEFERRABLE INITIALLY DEFERRED,
    transfer_direction TEXT CHECK (transfer_direction IN ('outflow', 'inflow')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (posting_state = 'posted' OR cleared_state = 'uncleared'),
    CHECK (
        (transfer_id IS NULL AND transfer_direction IS NULL AND amount_huf IS NOT NULL)
        OR (transfer_id IS NOT NULL AND transfer_direction IS NOT NULL AND amount_huf IS NULL)
    ),
    UNIQUE (id, transfer_id, transfer_direction),
    UNIQUE (transfer_id, transfer_direction)
) STRICT;

CREATE TRIGGER transfer_distinct_accounts_insert
BEFORE INSERT ON transactions WHEN NEW.transfer_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'A transfer needs two different accounts')
    WHERE EXISTS (
        SELECT 1 FROM transactions
        WHERE transfer_id = NEW.transfer_id AND account_id = NEW.account_id
    );
END;

CREATE TRIGGER transfer_distinct_accounts_update
BEFORE UPDATE OF account_id, transfer_id ON transactions WHEN NEW.transfer_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'A transfer needs two different accounts')
    WHERE EXISTS (
        SELECT 1 FROM transactions
        WHERE transfer_id = NEW.transfer_id AND account_id = NEW.account_id AND id <> NEW.id
    );
END;

CREATE INDEX transactions_account_date ON transactions(account_id, transaction_date, id);
CREATE INDEX transactions_category_date ON transactions(category_id, transaction_date);
CREATE INDEX transactions_payee ON transactions(payee_id);
CREATE INDEX categories_group_order ON categories(group_id, sort_order, id);
CREATE INDEX accounts_group_order ON accounts(closed, kind, sort_order, id);

CREATE VIEW ledger_entries AS
SELECT t.id, t.account_id, t.transaction_date, t.payee_id, t.category_id, t.memo, t.flag_id,
    CASE
        WHEN t.transfer_direction = 'outflow' THEN -p.amount_huf
        WHEN t.transfer_direction = 'inflow' THEN p.amount_huf
        ELSE t.amount_huf
    END AS amount_huf,
    t.cleared_state, t.posting_state, t.origin, t.scheduled_origin_id,
    t.import_row_id, t.transfer_id, t.transfer_direction, t.created_at
FROM transactions t LEFT JOIN transfers p ON p.id = t.transfer_id;
