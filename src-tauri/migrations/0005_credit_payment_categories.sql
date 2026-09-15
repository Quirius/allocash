-- A credit card's payment category is explicit. This is the prerequisite for
-- funded-card allocation and cash-vs-credit overspending semantics.
CREATE TABLE credit_payment_categories (
    account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id),
    category_id TEXT NOT NULL UNIQUE REFERENCES categories(id)
) STRICT;

CREATE TRIGGER credit_payment_category_requires_credit_insert
BEFORE INSERT ON credit_payment_categories
WHEN (SELECT kind FROM accounts WHERE id = NEW.account_id) <> 'credit'
BEGIN
    SELECT RAISE(ABORT, 'A payment category requires a credit account');
END;

CREATE TRIGGER credit_payment_category_requires_credit_update
BEFORE UPDATE OF account_id ON credit_payment_categories
WHEN (SELECT kind FROM accounts WHERE id = NEW.account_id) <> 'credit'
BEGIN
    SELECT RAISE(ABORT, 'A payment category requires a credit account');
END;
