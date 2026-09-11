pub mod database;
pub mod ledger;
mod migrations;
pub mod ynab_import;

#[cfg(test)]
mod schema_tests;

#[cfg(test)]
mod ledger_tests;

#[cfg(test)]
mod ynab_import_tests;

#[cfg(feature = "desktop")]
mod desktop;

#[cfg(feature = "desktop")]
pub use desktop::run;
