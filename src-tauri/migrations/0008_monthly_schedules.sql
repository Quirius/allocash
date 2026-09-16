CREATE TABLE schedules (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    payee_id TEXT REFERENCES payees(id),
    category_id TEXT REFERENCES categories(id),
    memo TEXT NOT NULL DEFAULT '',
    flag_id TEXT REFERENCES flags(id),
    amount_huf INTEGER NOT NULL CHECK (amount_huf <> 0),
    start_date TEXT NOT NULL CHECK (date(start_date) IS NOT NULL AND date(start_date) = start_date),
    day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
    end_date TEXT CHECK (end_date IS NULL OR (date(end_date) IS NOT NULL AND date(end_date) = end_date AND end_date >= start_date)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE schedule_occurrences (
    schedule_id TEXT NOT NULL REFERENCES schedules(id),
    occurrence_date TEXT NOT NULL CHECK (date(occurrence_date) IS NOT NULL AND date(occurrence_date) = occurrence_date),
    transaction_id TEXT UNIQUE REFERENCES transactions(id),
    state TEXT NOT NULL CHECK (state IN ('pending','posted','skipped')),
    PRIMARY KEY (schedule_id, occurrence_date)
) STRICT;
CREATE INDEX schedule_occurrences_pending ON schedule_occurrences(state, occurrence_date);
