/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Scenario execution results.

use crate::comparator::Difference;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Result of running a complete scenario.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioResult {
    /// Scenario ID.
    pub scenario_id: String,
    /// Whether the scenario passed.
    pub success: bool,
    /// Results for each stage.
    pub stage_results: Vec<StageResult>,
    /// Total execution time.
    #[serde(with = "duration_serde")]
    pub duration: Duration,
    /// Error that caused early termination, if any.
    pub fatal_error: Option<String>,
}

impl ScenarioResult {
    /// Create a new scenario result.
    pub fn new(scenario_id: impl Into<String>) -> Self {
        Self {
            scenario_id: scenario_id.into(),
            success: true,
            stage_results: Vec::new(),
            duration: Duration::ZERO,
            fatal_error: None,
        }
    }

    /// Add a stage result.
    pub fn add_stage(&mut self, result: StageResult) {
        if !result.success {
            self.success = false;
        }
        self.stage_results.push(result);
    }

    /// Mark as failed with a fatal error.
    pub fn fail_with(&mut self, error: impl Into<String>) {
        self.success = false;
        self.fatal_error = Some(error.into());
    }

    /// Get count of passed stages.
    pub fn passed_count(&self) -> usize {
        self.stage_results.iter().filter(|s| s.success).count()
    }

    /// Get count of failed stages.
    pub fn failed_count(&self) -> usize {
        self.stage_results.iter().filter(|s| !s.success).count()
    }
}

/// Result of running a single stage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageResult {
    /// Stage index (0-based).
    pub index: usize,
    /// Stage label, if any.
    pub label: Option<String>,
    /// Stage type.
    pub stage_type: String,
    /// Whether the stage passed.
    pub success: bool,
    /// Execution time for this stage.
    #[serde(with = "duration_serde")]
    pub duration: Duration,
    /// Error message, if failed.
    pub error: Option<String>,
    /// Comparison differences, if expectation failed.
    pub differences: Vec<String>,
    /// Line number in source file.
    pub line_number: Option<usize>,
}

impl StageResult {
    /// Create a passing stage result.
    pub fn pass(index: usize, stage_type: impl Into<String>) -> Self {
        Self {
            index,
            label: None,
            stage_type: stage_type.into(),
            success: true,
            duration: Duration::ZERO,
            error: None,
            differences: Vec::new(),
            line_number: None,
        }
    }

    /// Create a failing stage result with an error.
    pub fn fail_error(index: usize, stage_type: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            index,
            label: None,
            stage_type: stage_type.into(),
            success: false,
            duration: Duration::ZERO,
            error: Some(error.into()),
            differences: Vec::new(),
            line_number: None,
        }
    }

    /// Create a failing stage result with differences.
    pub fn fail_expectation(index: usize, differences: Vec<Difference>) -> Self {
        Self {
            index,
            label: None,
            stage_type: "expect".to_string(),
            success: false,
            duration: Duration::ZERO,
            error: None,
            differences: differences.iter().map(|d| d.to_string()).collect(),
            line_number: None,
        }
    }

    /// Set the label.
    pub fn with_label(mut self, label: Option<String>) -> Self {
        self.label = label;
        self
    }

    /// Set the line number.
    pub fn with_line(mut self, line: Option<usize>) -> Self {
        self.line_number = line;
        self
    }

    /// Set the duration.
    pub fn with_duration(mut self, duration: Duration) -> Self {
        self.duration = duration;
        self
    }
}

/// Result of running multiple scenarios.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunSummary {
    /// Total scenarios run.
    pub total: usize,
    /// Passed scenarios.
    pub passed: usize,
    /// Failed scenarios.
    pub failed: usize,
    /// Skipped scenarios.
    pub skipped: usize,
    /// Total execution time.
    #[serde(with = "duration_serde")]
    pub duration: Duration,
    /// Individual scenario results.
    pub results: Vec<ScenarioResult>,
}

impl RunSummary {
    /// Create a new empty summary.
    pub fn new() -> Self {
        Self {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: Duration::ZERO,
            results: Vec::new(),
        }
    }

    /// Add a scenario result.
    pub fn add(&mut self, result: ScenarioResult) {
        self.total += 1;
        if result.success {
            self.passed += 1;
        } else {
            self.failed += 1;
        }
        self.duration += result.duration;
        self.results.push(result);
    }

    /// Check if all scenarios passed.
    pub fn all_passed(&self) -> bool {
        self.failed == 0
    }
}

impl Default for RunSummary {
    fn default() -> Self {
        Self::new()
    }
}

// Serde helper for Duration
mod duration_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use std::time::Duration;

    pub fn serialize<S>(duration: &Duration, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        duration.as_millis().serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Duration, D::Error>
    where
        D: Deserializer<'de>,
    {
        let millis = u64::deserialize(deserializer)?;
        Ok(Duration::from_millis(millis))
    }
}
