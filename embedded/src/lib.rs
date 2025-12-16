/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! # TypeDB Embedded
//!
//! An embeddable TypeDB database for Rust applications, including WASM targets.
//!
//! This crate provides a pure Rust API for running TypeDB entirely in-memory,
//! suitable for embedding in applications that compile to `wasm32-unknown-unknown`.
//!
//! ## Quick Start
//!
//! ```rust,no_run
//! use typedb_embedded::{Database, Options, Error};
//!
//! fn main() -> Result<(), Error> {
//!     // Create an in-memory database
//!     let db = Database::new("mydb")?;
//!
//!     // Define schema
//!     {
//!         let mut tx = db.transaction_schema(Options::default())?;
//!         tx.execute("define entity person owns name; attribute name value string;")?;
//!         tx.commit()?;
//!     }
//!
//!     // Insert data
//!     {
//!         let tx = db.transaction_write(Options::default())?;
//!         // Write transactions auto-commit on execute
//!         tx.execute("insert $p isa person, has name \"Alice\";")?;
//!     }
//!
//!     // Query data
//!     {
//!         let tx = db.transaction_read(Options::default())?;
//!         let results = tx.query("match $p isa person, has name $n;")?;
//!         for row in results {
//!             println!("{:?}", row?);
//!         }
//!     }
//!
//!     Ok(())
//! }
//! ```
//!
//! ## Features
//!
//! - **Pure Rust**: No C/C++ dependencies, works on any target including WASM
//! - **In-Memory**: All data stored in memory (ephemeral)
//! - **Full TypeQL**: Complete TypeQL support for schema and queries
//! - **Embeddable**: Use as a library in your Rust application
//!
//! ## WASM Usage
//!
//! Add to your `Cargo.toml`:
//!
//! ```toml
//! [dependencies]
//! typedb-embedded = { version = "0.1", default-features = false, features = ["memory"] }
//! ```
//!
//! Then compile with:
//!
//! ```bash
//! cargo build --target wasm32-unknown-unknown
//! ```

#![deny(missing_docs)]

mod database_api;
mod error;
pub mod result;
pub mod schema;
mod transaction;

pub mod common_tests;

pub use database_api::Database;
pub use error::Error;
pub use options::TransactionOptions as Options;
pub use result::{AttributeValue, Row, Value};
pub use schema::{
    AttributeTypeSchema, CardinalitySchema, EntityTypeSchema, OrderingSchema, OwnsSchema,
    PlaysSchema, RangeConstraintSchema, RelatesSchema, RelationTypeSchema, RoleTypeSchema,
    SchemaSummary, ValueConstraintSchema, ValueTypeSchema,
};
pub use transaction::{QueryResultIterator, TransactionRead, TransactionSchema, TransactionWrite};
