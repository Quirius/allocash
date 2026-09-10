use crate::migrations;
use rusqlite::{params, Connection};

fn database() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .unwrap();
    migrations::initialize(&mut connection, None).unwrap();
    connection.execute_batch("INSERT INTO accounts (id,name,kind) VALUES ('cash','Cash','cash'),('credit','Card','credit');").unwrap();
    connection
}

fn pair(connection: &Connection) {
    connection.execute_batch("
        INSERT INTO transfers (id,amount_huf,outflow_id,inflow_id) VALUES ('pair',10000,'out','in');
        INSERT INTO transactions (id,account_id,transaction_date,transfer_id,transfer_direction)
            VALUES ('out','cash','2026-09-10','pair','outflow');
        INSERT INTO transactions (id,account_id,transaction_date,transfer_id,transfer_direction,cleared_state)
            VALUES ('in','credit','2026-09-10','pair','inflow','uncleared');
    ").unwrap();
}

#[test]
fn paired_transfers_have_one_amount_and_cannot_lose_a_side() {
    let mut connection = database();
    let transaction = connection.transaction().unwrap();
    pair(&transaction);
    transaction.commit().unwrap();
    connection
        .execute("UPDATE transfers SET amount_huf=25000 WHERE id='pair'", [])
        .unwrap();
    let amounts: Vec<i64> = connection
        .prepare("SELECT amount_huf FROM ledger_entries ORDER BY amount_huf")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(amounts, [-25000, 25000]);
    let transaction = connection.transaction().unwrap();
    transaction
        .execute("DELETE FROM transactions WHERE id='in'", [])
        .unwrap();
    assert!(transaction.commit().is_err());
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))
            .unwrap(),
        2
    );
    let transaction = connection.transaction().unwrap();
    transaction
        .execute("DELETE FROM transactions WHERE transfer_id='pair'", [])
        .unwrap();
    transaction
        .execute("DELETE FROM transfers WHERE id='pair'", [])
        .unwrap();
    transaction.commit().unwrap();
}

#[test]
fn incomplete_pairs_and_wrong_directions_cannot_commit() {
    let mut connection = database();
    let transaction = connection.transaction().unwrap();
    transaction
        .execute(
            "INSERT INTO transfers (id,amount_huf,outflow_id,inflow_id) VALUES ('p',10,'out','in')",
            [],
        )
        .unwrap();
    assert!(transaction.commit().is_err());
    let transaction = connection.transaction().unwrap();
    pair(&transaction);
    transaction
        .execute("UPDATE transfers SET outflow_id='in',inflow_id='out'", [])
        .unwrap();
    assert!(transaction.commit().is_err());
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM transfers", [], |row| row.get(0))
            .unwrap(),
        0
    );
}

#[test]
fn a_transfer_cannot_move_into_the_same_account() {
    let mut connection = database();
    let transaction = connection.transaction().unwrap();
    pair(&transaction);
    assert!(transaction
        .execute(
            "UPDATE transactions SET account_id='cash' WHERE id='in'",
            []
        )
        .is_err());
    transaction.commit().unwrap();
}

#[test]
fn money_is_integer_and_full_signed_range_is_preserved() {
    let connection = database();
    for (id, amount) in [("min", i64::MIN), ("max", i64::MAX), ("zero", 0)] {
        connection.execute("INSERT INTO transactions (id,account_id,transaction_date,amount_huf) VALUES (?1,'cash','2026-09-10',?2)", params![id,amount]).unwrap();
        assert_eq!(
            connection
                .query_row::<i64, _, _>(
                    "SELECT amount_huf FROM ledger_entries WHERE id=?1",
                    [id],
                    |row| row.get(0)
                )
                .unwrap(),
            amount
        );
    }
    assert!(connection.execute("INSERT INTO transactions (id,account_id,transaction_date,amount_huf) VALUES ('bad','cash','2026-09-10',1.5)", []).is_err());
}

#[test]
fn invalid_dates_are_rejected_including_non_leap_february() {
    let connection = database();
    for date in [
        "2026-02-29",
        "1900-02-29",
        "2026-04-31",
        "2026-13-01",
        "2026-00-10",
        "0000-01-01",
        "2026-9-10",
        "2026-09-10T00:00:00Z",
    ] {
        assert!(connection.execute("INSERT INTO transactions (id,account_id,transaction_date,amount_huf) VALUES (?1,'cash',?1,1)", [date]).is_err(), "{date}");
    }
    for date in ["2024-02-29", "2000-02-29", "2026-09-10"] {
        connection.execute("INSERT INTO transactions (id,account_id,transaction_date,amount_huf) VALUES (?1,'cash',?1,1)", [date]).unwrap();
    }
}

#[test]
fn scheduled_entries_must_be_uncleared() {
    let connection = database();
    assert!(connection.execute("INSERT INTO transactions (id,account_id,transaction_date,amount_huf,posting_state) VALUES ('bad','cash','2026-09-10',1,'scheduled')", []).is_err());
    connection.execute("INSERT INTO transactions (id,account_id,transaction_date,amount_huf,posting_state,cleared_state) VALUES ('good','cash','2026-09-10',1,'scheduled','uncleared')", []).unwrap();
    assert!(connection
        .execute(
            "UPDATE transactions SET cleared_state='reconciled' WHERE id='good'",
            []
        )
        .is_err());
}

#[test]
fn referenced_history_cannot_be_deleted_and_closing_preserves_type() {
    let connection = database();
    connection.execute_batch("
        INSERT INTO category_groups (id,name) VALUES ('g','Living');
        INSERT INTO categories (id,group_id,name) VALUES ('c','g','Groceries');
        INSERT INTO payees (id,name) VALUES ('p','Example shop');
        INSERT INTO transactions (id,account_id,transaction_date,amount_huf,category_id,payee_id,flag_id)
            VALUES ('t','cash','2026-09-10',-1000,'c','p','flag-orange');
    ").unwrap();
    for sql in [
        "DELETE FROM accounts WHERE id='cash'",
        "DELETE FROM categories",
        "DELETE FROM category_groups",
        "DELETE FROM payees",
        "DELETE FROM flags WHERE id='flag-orange'",
    ] {
        assert!(connection.execute(sql, []).is_err());
    }
    connection
        .execute("UPDATE accounts SET closed=1 WHERE id='cash'", [])
        .unwrap();
    connection
        .execute("UPDATE accounts SET closed=0 WHERE id='cash'", [])
        .unwrap();
    assert_eq!(
        connection
            .query_row::<String, _, _>("SELECT kind FROM accounts WHERE id='cash'", [], |row| row
                .get(0))
            .unwrap(),
        "cash"
    );
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT amount_huf FROM ledger_entries", [], |row| row
                .get(0))
            .unwrap(),
        -1000
    );
}

#[test]
fn raw_import_sources_are_preserved_and_source_rows_are_unique() {
    let connection = database();
    let bytes = b"anonymized archive bytes";
    connection.execute("INSERT INTO import_batches (id,source_name,source_bytes,sha256) VALUES ('b','fixture.zip',?1,?2)", params![bytes, "a".repeat(64)]).unwrap();
    connection
        .execute(
            "INSERT INTO import_rows VALUES ('r','b','Register.csv',2,'original row')",
            [],
        )
        .unwrap();
    assert!(connection
        .execute(
            "INSERT INTO import_rows VALUES ('r2','b','Register.csv',2,'original row')",
            []
        )
        .is_err());
    connection.execute("INSERT INTO transactions (id,account_id,transaction_date,amount_huf,origin,import_row_id) VALUES ('t','cash','2026-09-10',-100,'import','r')", []).unwrap();
    assert!(connection.execute("DELETE FROM import_rows", []).is_err());
    assert!(connection
        .execute("DELETE FROM import_batches", [])
        .is_err());
    assert_eq!(
        connection
            .query_row::<Vec<u8>, _, _>("SELECT source_bytes FROM import_batches", [], |row| row
                .get(0))
            .unwrap(),
        bytes
    );
}
