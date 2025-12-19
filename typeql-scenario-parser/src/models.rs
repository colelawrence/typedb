/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Data models for TypeQL scenarios.
//!
//! These structures represent parsed scenario files and their stages.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A complete scenario parsed from a Markdown file.
///
/// A scenario consists of metadata, optional description, and a sequence of stages
/// that are executed in order against a TypeQL backend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Scenario {
    /// Unique identifier for this scenario (from front matter or filename).
    pub id: String,

    /// Human-readable title (from first `#` heading).
    pub title: Option<String>,

    /// Description text (paragraphs before first code block).
    pub description: Option<String>,

    /// Tags for filtering and categorization.
    #[serde(default)]
    pub tags: Vec<String>,

    /// Arbitrary metadata from front matter.
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,

    /// Source file path (for error reporting).
    pub source_path: Option<String>,

    /// Ordered sequence of stages to execute.
    pub stages: Vec<Stage>,
}

impl Scenario {
    /// Create a new scenario with the given ID.
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            title: None,
            description: None,
            tags: Vec::new(),
            metadata: HashMap::new(),
            source_path: None,
            stages: Vec::new(),
        }
    }

    /// Add a stage to this scenario.
    pub fn add_stage(&mut self, stage: Stage) {
        self.stages.push(stage);
    }

    /// Check if this scenario has any expectation stages.
    pub fn has_expectations(&self) -> bool {
        self.stages.iter().any(|s| matches!(s.kind, StageKind::Expect(_)))
    }
}

/// A single stage in a scenario's execution.
///
/// Stages are executed sequentially. Each stage has a kind that determines
/// how it's processed by the runner.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Stage {
    /// The type and content of this stage.
    pub kind: StageKind,

    /// Optional label for this stage (for error reporting).
    pub label: Option<String>,

    /// Line number in source file (1-indexed).
    pub line_number: Option<usize>,

    /// Raw source text (for diagnostics).
    pub raw_source: Option<String>,
}

impl Stage {
    /// Create a new stage with the given kind.
    pub fn new(kind: StageKind) -> Self {
        Self {
            kind,
            label: None,
            line_number: None,
            raw_source: None,
        }
    }

    /// Create a schema stage.
    pub fn schema(typeql: impl Into<String>) -> Self {
        Self::new(StageKind::Schema(typeql.into()))
    }

    /// Create a data stage.
    pub fn data(typeql: impl Into<String>) -> Self {
        Self::new(StageKind::Data(typeql.into()))
    }

    /// Create a query stage.
    pub fn query(typeql: impl Into<String>) -> Self {
        Self::new(StageKind::Query(typeql.into()))
    }

    /// Create an expectation stage.
    pub fn expect(expectation: Expectation) -> Self {
        Self::new(StageKind::Expect(expectation))
    }

    /// Create an import stage.
    pub fn import(paths: Vec<String>) -> Self {
        Self::new(StageKind::Import(paths))
    }

    /// Set the label for this stage.
    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }

    /// Set the line number for this stage.
    pub fn with_line(mut self, line: usize) -> Self {
        self.line_number = Some(line);
        self
    }
}

/// The kind of a stage, determining how it's executed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StageKind {
    /// Schema definition stage (runs as `define`).
    Schema(String),

    /// Data modification stage (runs as `execute` - insert/delete/update/put).
    Data(String),

    /// Query execution stage (runs and captures results for expectations).
    Query(String),

    /// Expectation to check against the preceding query.
    Expect(Expectation),

    /// Raw TypeQL to execute (type inferred from content).
    Raw(String),

    /// Import stage - file paths to import setup stages from.
    /// Paths are relative to the importing file's directory.
    Import(Vec<String>),
}

/// Expectations for query results or errors.
///
/// Expectations define what the runner should verify after executing
/// a query or other TypeQL statement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Expectation {
    /// Expected row count (exact match).
    pub rows: Option<usize>,

    /// Expected column names (must all be present).
    pub columns: Option<Vec<String>>,

    /// Expected row values in order.
    /// Each inner vec is one row, containing stringified values.
    pub values: Option<Vec<Vec<serde_json::Value>>>,

    /// Expected row values (order-insensitive).
    pub values_unordered: Option<Vec<Vec<serde_json::Value>>>,

    /// Expected error message substring.
    pub error_contains: Option<String>,

    /// Expected error type.
    pub error_type: Option<ExpectedErrorType>,

    /// Numeric tolerance for floating-point comparisons.
    pub numeric_tolerance: Option<f64>,

    /// Whether to ignore extra columns in results.
    #[serde(default)]
    pub ignore_extra_columns: bool,
}

impl Expectation {
    /// Create an expectation for a specific row count.
    pub fn row_count(count: usize) -> Self {
        Self {
            rows: Some(count),
            ..Default::default()
        }
    }

    /// Create an expectation for an error containing the given message.
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            error_contains: Some(message.into()),
            ..Default::default()
        }
    }

    /// Create an expectation for empty results.
    pub fn empty() -> Self {
        Self::row_count(0)
    }

    /// Check if this expects an error.
    pub fn expects_error(&self) -> bool {
        self.error_contains.is_some() || self.error_type.is_some()
    }
}

/// Types of errors that can be expected.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExpectedErrorType {
    /// Parse error (syntax error in TypeQL).
    Parse,
    /// Schema error (invalid schema definition).
    Schema,
    /// Data error (constraint violation, etc.).
    Data,
    /// Any error type.
    Any,
}

/// Errors that can occur during parsing.
#[derive(Debug, Clone, thiserror::Error)]
pub enum ParseError {
    /// Invalid front matter format.
    #[error("Invalid front matter at line {line}: {message}")]
    InvalidFrontMatter { line: usize, message: String },

    /// Unknown code block type.
    #[error("Unknown block type '{block_type}' at line {line}")]
    UnknownBlockType { line: usize, block_type: String },

    /// Missing required field.
    #[error("Missing required field '{field}' at line {line}")]
    MissingField { line: usize, field: String },

    /// Expectation without preceding query.
    #[error("Expectation at line {line} has no preceding query")]
    OrphanedExpectation { line: usize },

    /// Invalid expectation format.
    #[error("Invalid expectation format at line {line}: {message}")]
    InvalidExpectation { line: usize, message: String },

    /// Circular import detected.
    #[error("Circular import detected: {chain}")]
    CircularImport { chain: String },

    /// File not found during import resolution.
    #[error("Import file not found: {path}")]
    ImportNotFound { path: String },

    /// I/O error.
    #[error("IO error: {0}")]
    Io(String),

    /// JSON parsing error.
    #[error("JSON error: {0}")]
    Json(String),
}
