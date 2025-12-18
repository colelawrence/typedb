/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Scenario execution engine.

use crate::{
    BackendError, QueryResult, ResultComparator, ScenarioResult,
    StageResult, TypeQLBackend,
};
use std::time::Instant;
use typeql_scenario_parser::{Scenario, Stage, StageKind};

/// Configuration for the scenario runner.
#[derive(Debug, Clone)]
pub struct RunnerConfig {
    /// Stop on first failure.
    pub fail_fast: bool,
    /// Numeric tolerance for comparisons.
    pub numeric_tolerance: f64,
    /// Timeout per stage in milliseconds.
    pub stage_timeout_ms: u64,
}

impl Default for RunnerConfig {
    fn default() -> Self {
        Self {
            fail_fast: false,
            numeric_tolerance: 1e-10,
            stage_timeout_ms: 30_000,
        }
    }
}

/// Executes TypeQL scenarios against a backend.
pub struct ScenarioRunner {
    /// The backend to execute against.
    backend: Box<dyn TypeQLBackend>,
    /// Runner configuration.
    config: RunnerConfig,
    /// Result comparator.
    comparator: ResultComparator,
}

impl ScenarioRunner {
    /// Create a new runner with the given backend.
    pub fn new(backend: Box<dyn TypeQLBackend>) -> Self {
        Self {
            backend,
            config: RunnerConfig::default(),
            comparator: ResultComparator::new(),
        }
    }

    /// Create a runner with custom configuration.
    pub fn with_config(backend: Box<dyn TypeQLBackend>, config: RunnerConfig) -> Self {
        Self {
            backend,
            config: config.clone(),
            comparator: ResultComparator::with_tolerance(config.numeric_tolerance),
        }
    }

    /// Run a single scenario.
    pub async fn run(&mut self, scenario: &Scenario) -> ScenarioResult {
        let start = Instant::now();
        let mut result = ScenarioResult::new(&scenario.id);

        // Setup backend
        if let Err(e) = self.backend.setup().await {
            result.fail_with(format!("Backend setup failed: {}", e));
            result.duration = start.elapsed();
            return result;
        }

        // Create fresh database
        let db_name = format!("scenario_{}", scenario.id.replace('-', "_"));
        if let Err(e) = self.backend.reset(&db_name).await {
            result.fail_with(format!("Database reset failed: {}", e));
            result.duration = start.elapsed();
            return result;
        }

        // Track the last query result for expectations
        let mut last_query_result: Option<Result<QueryResult, BackendError>> = None;

        // Execute stages
        for (idx, stage) in scenario.stages.iter().enumerate() {
            let stage_start = Instant::now();
            let stage_result = self
                .run_stage(idx, stage, &mut last_query_result)
                .await;

            let stage_result = stage_result
                .with_label(stage.label.clone())
                .with_line(stage.line_number)
                .with_duration(stage_start.elapsed());

            let failed = !stage_result.success;
            result.add_stage(stage_result);

            if failed && self.config.fail_fast {
                break;
            }
        }

        // Teardown
        if let Err(e) = self.backend.teardown().await {
            // Don't fail the scenario for teardown errors, just log
            eprintln!("Warning: teardown failed: {}", e);
        }

        result.duration = start.elapsed();
        result
    }

    /// Run a single stage.
    async fn run_stage(
        &mut self,
        index: usize,
        stage: &Stage,
        last_result: &mut Option<Result<QueryResult, BackendError>>,
    ) -> StageResult {
        match &stage.kind {
            StageKind::Schema(typeql) => self.run_schema(index, typeql).await,
            StageKind::Data(typeql) => self.run_data(index, typeql, last_result).await,
            StageKind::Query(typeql) => self.run_query(index, typeql, last_result).await,
            StageKind::Expect(expectation) => {
                self.check_expectation(index, last_result, expectation)
            }
            StageKind::Raw(typeql) => self.run_raw(index, typeql, last_result).await,
        }
    }

    async fn run_schema(&mut self, index: usize, typeql: &str) -> StageResult {
        match self.backend.define(typeql).await {
            Ok(()) => StageResult::pass(index, "schema"),
            Err(e) => StageResult::fail_error(index, "schema", e.to_string()),
        }
    }

    async fn run_data(
        &mut self,
        index: usize,
        typeql: &str,
        last_result: &mut Option<Result<QueryResult, BackendError>>,
    ) -> StageResult {
        let result = self.backend.execute(typeql).await;
        *last_result = Some(result.clone());

        match result {
            Ok(_) => StageResult::pass(index, "data"),
            Err(e) => StageResult::fail_error(index, "data", e.to_string()),
        }
    }

    async fn run_query(
        &mut self,
        index: usize,
        typeql: &str,
        last_result: &mut Option<Result<QueryResult, BackendError>>,
    ) -> StageResult {
        let result = self.backend.query(typeql).await;
        *last_result = Some(result.clone());

        match result {
            Ok(_) => StageResult::pass(index, "query"),
            Err(e) => StageResult::fail_error(index, "query", e.to_string()),
        }
    }

    async fn run_raw(
        &mut self,
        index: usize,
        typeql: &str,
        last_result: &mut Option<Result<QueryResult, BackendError>>,
    ) -> StageResult {
        // Skip empty blocks
        if typeql.trim().is_empty() {
            return StageResult::pass(index, "raw");
        }

        // Try to determine the type from content
        let trimmed = typeql.trim().to_lowercase();
        if trimmed.starts_with("define")
            || trimmed.starts_with("redefine")
            || trimmed.starts_with("undefine")
        {
            return self.run_schema(index, typeql).await;
        }

        if trimmed.starts_with("insert")
            || trimmed.starts_with("delete")
            || trimmed.starts_with("update")
            || trimmed.starts_with("put")
        {
            return self.run_data(index, typeql, last_result).await;
        }

        if trimmed.starts_with("match") || trimmed.starts_with("with") {
            // Could be query or match-insert, try execute first
            let result = self.backend.execute(typeql).await;
            *last_result = Some(result.clone());
            match result {
                Ok(_) => StageResult::pass(index, "raw"),
                Err(e) => StageResult::fail_error(index, "raw", e.to_string()),
            }
        } else {
            // Unknown, try query
            let result = self.backend.query(typeql).await;
            *last_result = Some(result.clone());
            match result {
                Ok(_) => StageResult::pass(index, "raw"),
                Err(e) => StageResult::fail_error(index, "raw", e.to_string()),
            }
        }
    }

    fn check_expectation(
        &self,
        index: usize,
        last_result: &Option<Result<QueryResult, BackendError>>,
        expectation: &typeql_scenario_parser::Expectation,
    ) -> StageResult {
        let Some(result) = last_result else {
            return StageResult::fail_error(
                index,
                "expect",
                "No preceding query result to check",
            );
        };

        let comparison = match result {
            Ok(query_result) => self.comparator.compare(query_result, expectation),
            Err(backend_error) => self.comparator.compare_error(backend_error, expectation),
        };

        if comparison.passed {
            StageResult::pass(index, "expect")
        } else {
            StageResult::fail_expectation(index, comparison.differences)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MockBackend;

    #[tokio::test]
    async fn test_runner_basic() {
        let mut backend = MockBackend::new();
        backend.queue_result(QueryResult::with_row_count(1));

        let mut runner = ScenarioRunner::new(Box::new(backend));

        let mut scenario = Scenario::new("test");
        scenario.add_stage(Stage::schema("define entity person;"));
        scenario.add_stage(Stage::query("match $p isa person;"));
        scenario.add_stage(Stage::expect(
            typeql_scenario_parser::Expectation::row_count(1),
        ));

        let result = runner.run(&scenario).await;
        assert!(result.success);
        assert_eq!(result.stage_results.len(), 3);
    }

    #[tokio::test]
    async fn test_runner_expectation_failure() {
        let mut backend = MockBackend::new();
        backend.queue_result(QueryResult::with_row_count(5));

        let mut runner = ScenarioRunner::new(Box::new(backend));

        let mut scenario = Scenario::new("test");
        scenario.add_stage(Stage::query("match $p isa person;"));
        scenario.add_stage(Stage::expect(
            typeql_scenario_parser::Expectation::row_count(10),
        ));

        let result = runner.run(&scenario).await;
        assert!(!result.success);
        assert!(!result.stage_results[1].success);
    }
}
