/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! # TypeQL Scenario Runner
//!
//! Executes TypeQL scenarios against pluggable backends.
//!
//! ## Overview
//!
//! The runner takes parsed scenarios and executes them stage-by-stage against
//! a [`TypeQLBackend`] implementation. Results are captured and compared
//! against expectations.
//!
//! ## Backend Trait
//!
//! Implement [`TypeQLBackend`] to connect the runner to different TypeQL
//! execution environments:
//!
//! - Embedded TypeDB (via WASM)
//! - TypeDB Server (via gRPC)
//! - Mock backends for testing
//!
//! ## Example
//!
//! ```ignore
//! use typeql_scenario_runner::{ScenarioRunner, TypeQLBackend};
//!
//! let scenario = parse_scenario_file("test.md")?;
//! let backend = EmbeddedBackend::new()?;
//! let runner = ScenarioRunner::new(Box::new(backend));
//! let result = runner.run(&scenario).await?;
//!
//! assert!(result.success);
//! ```

mod backend;
mod comparator;
mod result;
mod runner;

pub use backend::*;
pub use comparator::*;
pub use result::*;
pub use runner::*;

// Re-export parser types for convenience
pub use typeql_scenario_parser::{Expectation, Scenario, Stage, StageKind};
