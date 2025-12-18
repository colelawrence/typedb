/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! # TypeQL Scenario Parser
//!
//! Parses TypeQL scenario files written in Markdown with fenced code blocks.
//!
//! ## File Format
//!
//! Scenario files use Markdown with special fenced code blocks:
//!
//! ````markdown
//! ---
//! id: example-scenario
//! tags: [basic, query]
//! ---
//!
//! # Scenario Title
//!
//! Description of what this scenario tests.
//!
//! ```typeql:schema
//! define
//! attribute name, value string;
//! entity person, owns name;
//! ```
//!
//! ```typeql:data
//! insert $p isa person, has name "Alice";
//! ```
//!
//! ```typeql:query
//! match $p isa person, has name $n;
//! ```
//!
//! ```typeql:expect
//! rows: 1
//! columns: [p, n]
//! ```
//! ````
//!
//! ## Stage Types
//!
//! - `typeql:schema` - Schema definition (runs as `define`)
//! - `typeql:data` - Data insertion/modification (runs as `execute`)
//! - `typeql:query` - Query to execute and check expectations
//! - `typeql:expect` - Expected results for the preceding query
//! - `typeql:error` - Expected error for the preceding stage
//!
//! ## Expectations
//!
//! Expectations can specify:
//! - `rows: N` - Expected row count
//! - `columns: [a, b]` - Expected column names
//! - `values: [[...], [...]]` - Expected row values (order-sensitive)
//! - `values_unordered: [[...], [...]]` - Expected values (order-insensitive)
//! - `error_contains: "message"` - Expected error substring

mod models;
mod parser;

pub use models::*;
pub use parser::*;
