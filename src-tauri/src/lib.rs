pub mod database;
mod migrations;

#[cfg(test)]
mod schema_tests;

#[cfg(feature = "desktop")]
mod desktop;

#[cfg(feature = "desktop")]
pub use desktop::run;
