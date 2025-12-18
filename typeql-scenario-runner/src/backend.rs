/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! TypeQL backend trait and related types.
//!
//! The [`TypeQLBackend`] trait abstracts over different TypeQL execution
//! environments, allowing scenarios to run against:
//!
//! - Embedded TypeDB (WASM-based, in-process)
//! - TypeDB Server (gRPC connection)
//! - Mock backends (for unit testing the runner itself)
//!
//! ## Backend Lifecycle
//!
//! 1. Backend is created with configuration
//! 2. [`setup`](TypeQLBackend::setup) is called once before any scenarios
//! 3. For each scenario:
//!    - [`reset`](TypeQLBackend::reset) creates a fresh database
//!    - Schema/data/query stages are executed
//!    - [`teardown`](TypeQLBackend::teardown) cleans up
//! 4. Backend is dropped
//!
//! ## Error Handling
//!
//! Backends should return appropriate [`BackendError`] variants to allow
//! the runner to distinguish between:
//!
//! - Parse errors (TypeQL syntax)
//! - Schema errors (invalid definitions)
//! - Data errors (constraint violations)
//! - Connection/internal errors

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A TypeQL execution backend.
///
/// Implementations provide the ability to execute TypeQL statements
/// and return structured results.
///
/// # Thread Safety
///
/// Backends should be `Send` and `Sync` to allow concurrent scenario
/// execution. If the underlying system is not thread-safe, use
/// appropriate synchronization.
///
/// # Example Implementation
///
/// ```ignore
/// struct MockBackend {
///     results: Vec<QueryResult>,
/// }
///
/// #[async_trait]
/// impl TypeQLBackend for MockBackend {
///     async fn setup(&mut self) -> Result<(), BackendError> {
///         Ok(())
///     }
///
///     async fn reset(&mut self, db_name: &str) -> Result<(), BackendError> {
///         self.results.clear();
///         Ok(())
///     }
///
///     async fn define(&mut self, typeql: &str) -> Result<(), BackendError> {
///         // Validate schema syntax, store for later
///         Ok(())
///     }
///
///     async fn execute(&mut self, typeql: &str) -> Result<QueryResult, BackendError> {
///         // Execute insert/delete/update/put
///         Ok(QueryResult::empty())
///     }
///
///     async fn query(&mut self, typeql: &str) -> Result<QueryResult, BackendError> {
///         // Execute query and return results
///         Ok(self.results.pop().unwrap_or_default())
///     }
///
///     async fn teardown(&mut self) -> Result<(), BackendError> {
///         Ok(())
///     }
/// }
/// ```
#[async_trait]
pub trait TypeQLBackend: Send + Sync {
    /// Initialize the backend.
    ///
    /// Called once before any scenarios are run. Use this to establish
    /// connections, initialize resources, etc.
    async fn setup(&mut self) -> Result<(), BackendError>;

    /// Reset to a fresh database state.
    ///
    /// Called before each scenario. Should create a new, empty database
    /// with the given name (or a generated name if empty).
    async fn reset(&mut self, db_name: &str) -> Result<(), BackendError>;

    /// Execute a schema definition.
    ///
    /// Runs a `define`, `redefine`, or `undefine` statement.
    async fn define(&mut self, typeql: &str) -> Result<(), BackendError>;

    /// Execute a data modification.
    ///
    /// Runs `insert`, `delete`, `update`, or `put` statements.
    /// Returns results (e.g., for match-insert queries).
    async fn execute(&mut self, typeql: &str) -> Result<QueryResult, BackendError>;

    /// Execute a query and return results.
    ///
    /// Runs `match` queries (possibly with `select`, `reduce`, etc.)
    /// and returns the result rows.
    async fn query(&mut self, typeql: &str) -> Result<QueryResult, BackendError>;

    /// Clean up after a scenario.
    ///
    /// Called after each scenario completes. Should drop the database
    /// created in `reset`.
    async fn teardown(&mut self) -> Result<(), BackendError>;

    /// Get backend name for logging/reporting.
    fn name(&self) -> &str {
        "unknown"
    }

    /// Check if the backend is connected/ready.
    async fn is_ready(&self) -> bool {
        true
    }
}

/// Result of a TypeQL query execution.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryResult {
    /// Column names in the result.
    pub columns: Vec<String>,

    /// Result rows, each row is a map of column name to value.
    pub rows: Vec<HashMap<String, ResultValue>>,

    /// Total row count (may differ from rows.len() if streaming/limited).
    pub row_count: usize,

    /// Whether the query had a write effect.
    pub had_write: bool,

    /// Execution time in milliseconds.
    pub execution_time_ms: Option<u64>,
}

impl QueryResult {
    /// Create an empty result.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Create a result with the given row count.
    pub fn with_row_count(count: usize) -> Self {
        Self {
            row_count: count,
            ..Default::default()
        }
    }

    /// Check if the result is empty.
    pub fn is_empty(&self) -> bool {
        self.row_count == 0
    }

    /// Get the first row, if any.
    pub fn first(&self) -> Option<&HashMap<String, ResultValue>> {
        self.rows.first()
    }

    /// Add a row to the result.
    pub fn add_row(&mut self, row: HashMap<String, ResultValue>) {
        self.rows.push(row);
        self.row_count = self.rows.len();
    }
}

/// A value in a query result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ResultValue {
    /// Null/missing value.
    Null,
    /// Boolean value.
    Boolean(bool),
    /// Integer value.
    Integer(i64),
    /// Floating-point value.
    Double(f64),
    /// Decimal value (as string to preserve precision).
    Decimal(String),
    /// String value.
    String(String),
    /// Date value (ISO 8601 format).
    Date(String),
    /// DateTime value (ISO 8601 format).
    DateTime(String),
    /// Duration value (ISO 8601 format).
    Duration(String),
    /// Entity/relation reference (IID).
    Concept { iid: String, type_name: String },
    /// List of values.
    List(Vec<ResultValue>),
    /// Struct value.
    Struct(HashMap<String, ResultValue>),
}

impl ResultValue {
    /// Get as string, if applicable.
    pub fn as_string(&self) -> Option<&str> {
        match self {
            ResultValue::String(s) => Some(s),
            _ => None,
        }
    }

    /// Get as integer, if applicable.
    pub fn as_integer(&self) -> Option<i64> {
        match self {
            ResultValue::Integer(i) => Some(*i),
            _ => None,
        }
    }

    /// Get as boolean, if applicable.
    pub fn as_boolean(&self) -> Option<bool> {
        match self {
            ResultValue::Boolean(b) => Some(*b),
            _ => None,
        }
    }

    /// Get as float, if applicable.
    pub fn as_double(&self) -> Option<f64> {
        match self {
            ResultValue::Double(f) => Some(*f),
            ResultValue::Integer(i) => Some(*i as f64),
            _ => None,
        }
    }

    /// Convert to a comparable string representation.
    pub fn to_comparable_string(&self) -> String {
        match self {
            ResultValue::Null => "null".to_string(),
            ResultValue::Boolean(b) => b.to_string(),
            ResultValue::Integer(i) => i.to_string(),
            ResultValue::Double(f) => format!("{:.6}", f),
            ResultValue::Decimal(d) => d.clone(),
            ResultValue::String(s) => s.clone(),
            ResultValue::Date(d) => d.clone(),
            ResultValue::DateTime(dt) => dt.clone(),
            ResultValue::Duration(d) => d.clone(),
            ResultValue::Concept { iid, type_name } => format!("{}:{}", type_name, iid),
            ResultValue::List(items) => {
                let inner: Vec<_> = items.iter().map(|v| v.to_comparable_string()).collect();
                format!("[{}]", inner.join(", "))
            }
            ResultValue::Struct(fields) => {
                let inner: Vec<_> = fields
                    .iter()
                    .map(|(k, v)| format!("{}: {}", k, v.to_comparable_string()))
                    .collect();
                format!("{{{}}}", inner.join(", "))
            }
        }
    }
}

/// Errors from backend operations.
#[derive(Debug, Clone, thiserror::Error)]
pub enum BackendError {
    /// TypeQL parse error.
    #[error("Parse error: {message}")]
    Parse { message: String, position: Option<String> },

    /// Schema definition error.
    #[error("Schema error: {message}")]
    Schema { message: String },

    /// Data/constraint error.
    #[error("Data error: {message}")]
    Data { message: String },

    /// Connection error.
    #[error("Connection error: {message}")]
    Connection { message: String },

    /// Internal/unexpected error.
    #[error("Internal error: {message}")]
    Internal { message: String },

    /// Timeout error.
    #[error("Timeout after {timeout_ms}ms")]
    Timeout { timeout_ms: u64 },
}

impl BackendError {
    /// Create a parse error.
    pub fn parse(message: impl Into<String>) -> Self {
        Self::Parse {
            message: message.into(),
            position: None,
        }
    }

    /// Create a schema error.
    pub fn schema(message: impl Into<String>) -> Self {
        Self::Schema {
            message: message.into(),
        }
    }

    /// Create a data error.
    pub fn data(message: impl Into<String>) -> Self {
        Self::Data {
            message: message.into(),
        }
    }

    /// Create a connection error.
    pub fn connection(message: impl Into<String>) -> Self {
        Self::Connection {
            message: message.into(),
        }
    }

    /// Create an internal error.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }

    /// Check if this is a parse error.
    pub fn is_parse(&self) -> bool {
        matches!(self, Self::Parse { .. })
    }

    /// Check if this is a schema error.
    pub fn is_schema(&self) -> bool {
        matches!(self, Self::Schema { .. })
    }

    /// Check if this is a data error.
    pub fn is_data(&self) -> bool {
        matches!(self, Self::Data { .. })
    }
}

/// A mock backend for testing the runner.
#[derive(Debug, Default)]
pub struct MockBackend {
    /// Canned results to return for queries.
    pub query_results: Vec<QueryResult>,
    /// Errors to return for operations.
    pub errors: Vec<Option<BackendError>>,
    /// Record of executed statements.
    pub executed: Vec<String>,
}

impl MockBackend {
    /// Create a new mock backend.
    pub fn new() -> Self {
        Self::default()
    }

    /// Queue a result to return for the next query.
    pub fn queue_result(&mut self, result: QueryResult) {
        self.query_results.push(result);
    }

    /// Queue an error to return for the next operation.
    pub fn queue_error(&mut self, error: BackendError) {
        self.errors.push(Some(error));
    }

    fn pop_error(&mut self) -> Option<BackendError> {
        self.errors.pop().flatten()
    }
}

#[async_trait]
impl TypeQLBackend for MockBackend {
    async fn setup(&mut self) -> Result<(), BackendError> {
        if let Some(err) = self.pop_error() {
            return Err(err);
        }
        Ok(())
    }

    async fn reset(&mut self, _db_name: &str) -> Result<(), BackendError> {
        if let Some(err) = self.pop_error() {
            return Err(err);
        }
        self.executed.clear();
        Ok(())
    }

    async fn define(&mut self, typeql: &str) -> Result<(), BackendError> {
        if let Some(err) = self.pop_error() {
            return Err(err);
        }
        self.executed.push(format!("DEFINE: {}", typeql));
        Ok(())
    }

    async fn execute(&mut self, typeql: &str) -> Result<QueryResult, BackendError> {
        if let Some(err) = self.pop_error() {
            return Err(err);
        }
        self.executed.push(format!("EXECUTE: {}", typeql));
        Ok(self.query_results.pop().unwrap_or_default())
    }

    async fn query(&mut self, typeql: &str) -> Result<QueryResult, BackendError> {
        if let Some(err) = self.pop_error() {
            return Err(err);
        }
        self.executed.push(format!("QUERY: {}", typeql));
        Ok(self.query_results.pop().unwrap_or_default())
    }

    async fn teardown(&mut self) -> Result<(), BackendError> {
        if let Some(err) = self.pop_error() {
            return Err(err);
        }
        Ok(())
    }

    fn name(&self) -> &str {
        "mock"
    }
}
