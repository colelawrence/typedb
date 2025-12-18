/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Result comparison utilities.
//!
//! Provides functionality to compare actual query results against
//! expected values defined in scenario expectations.

use crate::{BackendError, Expectation, QueryResult, ResultValue};
use typeql_scenario_parser::ExpectedErrorType;

/// Result of comparing actual results to expectations.
#[derive(Debug, Clone)]
pub struct ComparisonResult {
    /// Whether the comparison passed.
    pub passed: bool,
    /// Differences found, if any.
    pub differences: Vec<Difference>,
}

impl ComparisonResult {
    /// Create a passing result.
    pub fn pass() -> Self {
        Self {
            passed: true,
            differences: Vec::new(),
        }
    }

    /// Create a failing result with differences.
    pub fn fail(differences: Vec<Difference>) -> Self {
        Self {
            passed: false,
            differences,
        }
    }

    /// Create a failing result with a single difference.
    pub fn fail_single(diff: Difference) -> Self {
        Self::fail(vec![diff])
    }
}

/// A difference between expected and actual results.
#[derive(Debug, Clone)]
pub enum Difference {
    /// Row count mismatch.
    RowCount { expected: usize, actual: usize },
    /// Missing expected column.
    MissingColumn { column: String },
    /// Extra unexpected column.
    ExtraColumn { column: String },
    /// Value mismatch at specific position.
    ValueMismatch {
        row: usize,
        column: String,
        expected: String,
        actual: String,
    },
    /// Missing expected row.
    MissingRow { row: usize, expected: String },
    /// Extra unexpected row.
    ExtraRow { row: usize, actual: String },
    /// Expected error but got success.
    ExpectedError { expected: String },
    /// Got error but expected success.
    UnexpectedError { error: String },
    /// Error type mismatch.
    ErrorTypeMismatch {
        expected: ExpectedErrorType,
        actual: String,
    },
    /// Error message doesn't contain expected substring.
    ErrorMessageMismatch { expected: String, actual: String },
}

impl std::fmt::Display for Difference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Difference::RowCount { expected, actual } => {
                write!(f, "Row count: expected {}, got {}", expected, actual)
            }
            Difference::MissingColumn { column } => {
                write!(f, "Missing column: {}", column)
            }
            Difference::ExtraColumn { column } => {
                write!(f, "Extra column: {}", column)
            }
            Difference::ValueMismatch {
                row,
                column,
                expected,
                actual,
            } => {
                write!(
                    f,
                    "Row {}, column '{}': expected '{}', got '{}'",
                    row, column, expected, actual
                )
            }
            Difference::MissingRow { row, expected } => {
                write!(f, "Missing row {}: {}", row, expected)
            }
            Difference::ExtraRow { row, actual } => {
                write!(f, "Extra row {}: {}", row, actual)
            }
            Difference::ExpectedError { expected } => {
                write!(f, "Expected error containing '{}', but query succeeded", expected)
            }
            Difference::UnexpectedError { error } => {
                write!(f, "Unexpected error: {}", error)
            }
            Difference::ErrorTypeMismatch { expected, actual } => {
                write!(f, "Error type: expected {:?}, got {}", expected, actual)
            }
            Difference::ErrorMessageMismatch { expected, actual } => {
                write!(
                    f,
                    "Error message: expected to contain '{}', got '{}'",
                    expected, actual
                )
            }
        }
    }
}

/// Compare query results against expectations.
pub struct ResultComparator {
    /// Numeric tolerance for floating-point comparisons.
    pub numeric_tolerance: f64,
}

impl Default for ResultComparator {
    fn default() -> Self {
        Self::new()
    }
}

impl ResultComparator {
    /// Create a new comparator with default tolerance.
    pub fn new() -> Self {
        Self {
            numeric_tolerance: 1e-10,
        }
    }

    /// Create a comparator with custom tolerance.
    pub fn with_tolerance(tolerance: f64) -> Self {
        Self {
            numeric_tolerance: tolerance,
        }
    }

    /// Compare a successful result against expectations.
    pub fn compare(
        &self,
        result: &QueryResult,
        expectation: &Expectation,
    ) -> ComparisonResult {
        let mut differences = Vec::new();

        // Check if we expected an error
        if expectation.expects_error() {
            differences.push(Difference::ExpectedError {
                expected: expectation
                    .error_contains
                    .clone()
                    .unwrap_or_else(|| "any error".to_string()),
            });
            return ComparisonResult::fail(differences);
        }

        // Check row count
        if let Some(expected_rows) = expectation.rows {
            if result.row_count != expected_rows {
                differences.push(Difference::RowCount {
                    expected: expected_rows,
                    actual: result.row_count,
                });
            }
        }

        // Check columns
        if let Some(ref expected_cols) = expectation.columns {
            for col in expected_cols {
                if !result.columns.contains(col) {
                    differences.push(Difference::MissingColumn {
                        column: col.clone(),
                    });
                }
            }

            if !expectation.ignore_extra_columns {
                for col in &result.columns {
                    if !expected_cols.contains(col) {
                        differences.push(Difference::ExtraColumn {
                            column: col.clone(),
                        });
                    }
                }
            }
        }

        // Check values (order-sensitive)
        if let Some(ref expected_values) = expectation.values {
            self.compare_values_ordered(result, expected_values, &mut differences);
        }

        // Check values (order-insensitive)
        if let Some(ref expected_values) = expectation.values_unordered {
            self.compare_values_unordered(result, expected_values, &mut differences);
        }

        if differences.is_empty() {
            ComparisonResult::pass()
        } else {
            ComparisonResult::fail(differences)
        }
    }

    /// Compare an error result against expectations.
    pub fn compare_error(
        &self,
        error: &BackendError,
        expectation: &Expectation,
    ) -> ComparisonResult {
        let error_message = error.to_string();

        // Check if we expected an error
        if !expectation.expects_error() {
            return ComparisonResult::fail_single(Difference::UnexpectedError {
                error: error_message,
            });
        }

        let mut differences = Vec::new();

        // Check error type
        if let Some(ref expected_type) = expectation.error_type {
            let matches = match expected_type {
                ExpectedErrorType::Parse => error.is_parse(),
                ExpectedErrorType::Schema => error.is_schema(),
                ExpectedErrorType::Data => error.is_data(),
                ExpectedErrorType::Any => true,
            };

            if !matches {
                differences.push(Difference::ErrorTypeMismatch {
                    expected: expected_type.clone(),
                    actual: self.error_type_name(error),
                });
            }
        }

        // Check error message contains expected substring
        if let Some(ref expected_msg) = expectation.error_contains {
            if !error_message.to_lowercase().contains(&expected_msg.to_lowercase()) {
                differences.push(Difference::ErrorMessageMismatch {
                    expected: expected_msg.clone(),
                    actual: error_message,
                });
            }
        }

        if differences.is_empty() {
            ComparisonResult::pass()
        } else {
            ComparisonResult::fail(differences)
        }
    }

    fn error_type_name(&self, error: &BackendError) -> String {
        match error {
            BackendError::Parse { .. } => "parse".to_string(),
            BackendError::Schema { .. } => "schema".to_string(),
            BackendError::Data { .. } => "data".to_string(),
            BackendError::Connection { .. } => "connection".to_string(),
            BackendError::Internal { .. } => "internal".to_string(),
            BackendError::Timeout { .. } => "timeout".to_string(),
        }
    }

    fn compare_values_ordered(
        &self,
        result: &QueryResult,
        expected: &[Vec<serde_json::Value>],
        differences: &mut Vec<Difference>,
    ) {
        for (row_idx, expected_row) in expected.iter().enumerate() {
            if row_idx >= result.rows.len() {
                differences.push(Difference::MissingRow {
                    row: row_idx,
                    expected: format!("{:?}", expected_row),
                });
                continue;
            }

            let actual_row = &result.rows[row_idx];
            for (col_idx, expected_val) in expected_row.iter().enumerate() {
                if col_idx >= result.columns.len() {
                    continue;
                }
                let col_name = &result.columns[col_idx];
                if let Some(actual_val) = actual_row.get(col_name) {
                    if !self.values_equal(expected_val, actual_val) {
                        differences.push(Difference::ValueMismatch {
                            row: row_idx,
                            column: col_name.clone(),
                            expected: format!("{}", expected_val),
                            actual: actual_val.to_comparable_string(),
                        });
                    }
                }
            }
        }

        // Check for extra rows
        for row_idx in expected.len()..result.rows.len() {
            differences.push(Difference::ExtraRow {
                row: row_idx,
                actual: format!("{:?}", result.rows[row_idx]),
            });
        }
    }

    fn compare_values_unordered(
        &self,
        result: &QueryResult,
        expected: &[Vec<serde_json::Value>],
        differences: &mut Vec<Difference>,
    ) {
        // Convert result rows to comparable strings
        let actual_strings: Vec<String> = result
            .rows
            .iter()
            .map(|row| {
                result
                    .columns
                    .iter()
                    .filter_map(|col| row.get(col).map(|v| v.to_comparable_string()))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .collect();

        let expected_strings: Vec<String> = expected
            .iter()
            .map(|row| {
                row.iter()
                    .map(|v| format!("{}", v))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .collect();

        // Check each expected row exists in actual
        for (idx, exp) in expected_strings.iter().enumerate() {
            if !actual_strings.iter().any(|a| a.contains(exp) || exp.contains(a)) {
                differences.push(Difference::MissingRow {
                    row: idx,
                    expected: exp.clone(),
                });
            }
        }

        // Check row count matches
        if expected.len() != result.rows.len() {
            // Only add if not already flagged
            let has_count_diff = differences.iter().any(|d| matches!(d, Difference::RowCount { .. }));
            if !has_count_diff {
                differences.push(Difference::RowCount {
                    expected: expected.len(),
                    actual: result.rows.len(),
                });
            }
        }
    }

    fn values_equal(&self, expected: &serde_json::Value, actual: &ResultValue) -> bool {
        match (expected, actual) {
            (serde_json::Value::Null, ResultValue::Null) => true,
            (serde_json::Value::Bool(e), ResultValue::Boolean(a)) => e == a,
            (serde_json::Value::Number(e), ResultValue::Integer(a)) => {
                e.as_i64().map(|n| n == *a).unwrap_or(false)
            }
            (serde_json::Value::Number(e), ResultValue::Double(a)) => {
                e.as_f64()
                    .map(|n| (n - a).abs() < self.numeric_tolerance)
                    .unwrap_or(false)
            }
            (serde_json::Value::String(e), ResultValue::String(a)) => e == a,
            (serde_json::Value::String(e), _) => {
                // Allow string comparison for any value type
                e == &actual.to_comparable_string()
            }
            _ => false,
        }
    }
}
