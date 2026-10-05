ALTER TABLE schedules ADD COLUMN interval_months INTEGER NOT NULL DEFAULT 1 CHECK (interval_months IN (1, 3, 12));
ALTER TABLE schedules ADD COLUMN counterpart_account_id TEXT REFERENCES accounts(id);
