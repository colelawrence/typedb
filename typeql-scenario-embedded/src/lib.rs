/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! # TypeQL Scenario Embedded Backend
//!
//! Provides an embedded TypeDB backend for the TypeQL scenario runner.
//!
//! This backend uses the `typedb-embedded` crate to run scenarios against
//! an in-memory TypeDB instance, without requiring a separate server.
//!
//! ## Example
//!
//! ```ignore
//! use typeql_scenario_embedded::EmbeddedBackend;
//! use typeql_scenario_runner::{ScenarioRunner, TypeQLBackend};
//!
//! let backend = Box::new(EmbeddedBackend::new());
//! let mut runner = ScenarioRunner::new(backend);
//! let result = runner.run(&scenario).await?;
//! ```

use async_trait::async_trait;
use std::collections::HashMap;
use typedb_embedded::{
    AttributeValue, Database, Error as TypeDBError, Options, QueryResultIterator, Row, Value,
};
use typeql_scenario_runner::{BackendError, QueryResult, ResultValue, TypeQLBackend};

/// An embedded TypeDB backend for scenario execution.
///
/// This backend creates in-memory databases for each scenario run,
/// providing complete isolation between scenarios.
pub struct EmbeddedBackend {
    db: Option<Database>,
    current_db_name: Option<String>,
}

impl EmbeddedBackend {
    /// Create a new embedded backend.
    pub fn new() -> Self {
        Self {
            db: None,
            current_db_name: None,
        }
    }

    /// Get the current database, or return an error if none exists.
    fn get_db(&self) -> Result<&Database, BackendError> {
        self.db
            .as_ref()
            .ok_or_else(|| BackendError::internal("No database initialized"))
    }
}

impl Default for EmbeddedBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TypeQLBackend for EmbeddedBackend {
    async fn setup(&mut self) -> Result<(), BackendError> {
        // No setup needed for embedded backend
        Ok(())
    }

    async fn reset(&mut self, db_name: &str) -> Result<(), BackendError> {
        // Drop existing database by replacing with new one
        self.db = Some(
            Database::new(db_name).map_err(|e| BackendError::internal(format!("Failed to create database: {}", e)))?,
        );
        self.current_db_name = Some(db_name.to_string());
        Ok(())
    }

    async fn define(&mut self, typeql: &str) -> Result<(), BackendError> {
        let db = self.get_db()?;

        let mut tx = db
            .transaction_schema(Options::default())
            .map_err(|e| BackendError::internal(format!("Failed to open schema transaction: {}", e)))?;

        tx.execute(typeql).map_err(|e| map_typedb_error(e))?;

        tx.commit()
            .map_err(|e| BackendError::schema(format!("Failed to commit schema: {}", e)))?;

        Ok(())
    }

    async fn execute(&mut self, typeql: &str) -> Result<QueryResult, BackendError> {
        let db = self.get_db()?;

        let tx = db
            .transaction_write(Options::default())
            .map_err(|e| BackendError::internal(format!("Failed to open write transaction: {}", e)))?;

        let count = tx.execute(typeql).map_err(|e| map_typedb_error(e))?;

        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: count,
            had_write: true,
            execution_time_ms: None,
        })
    }

    async fn query(&mut self, typeql: &str) -> Result<QueryResult, BackendError> {
        let db = self.get_db()?;

        let tx = db
            .transaction_read(Options::default())
            .map_err(|e| BackendError::internal(format!("Failed to open read transaction: {}", e)))?;

        let results = tx.query(typeql).map_err(|e| map_typedb_error(e))?;

        convert_query_results(results)
    }

    async fn teardown(&mut self) -> Result<(), BackendError> {
        // Drop the database by clearing the reference
        self.db = None;
        self.current_db_name = None;
        Ok(())
    }

    fn name(&self) -> &str {
        "embedded"
    }

    async fn is_ready(&self) -> bool {
        true
    }
}

/// Convert TypeDB embedded error to BackendError.
fn map_typedb_error(error: TypeDBError) -> BackendError {
    match error {
        TypeDBError::Parse(msg) => BackendError::parse(msg),
        TypeDBError::Schema(msg) => BackendError::schema(msg),
        TypeDBError::Query(msg) => {
            // Try to classify query errors
            let msg_lower = msg.to_lowercase();
            if msg_lower.contains("not found") || msg_lower.contains("does not exist") {
                BackendError::schema(msg)
            } else if msg_lower.contains("constraint") || msg_lower.contains("violation") {
                BackendError::data(msg)
            } else {
                BackendError::data(msg)
            }
        }
        TypeDBError::Database(msg) => BackendError::connection(msg),
        TypeDBError::Transaction(msg) => BackendError::internal(msg),
        TypeDBError::Commit(msg) => BackendError::schema(msg),
    }
}

/// Convert query results iterator to QueryResult.
fn convert_query_results(iter: QueryResultIterator) -> Result<QueryResult, BackendError> {
    let columns = iter.columns().to_vec();
    let mut result = QueryResult {
        columns: columns.clone(),
        rows: Vec::new(),
        row_count: 0,
        had_write: false,
        execution_time_ms: None,
    };

    for row_result in iter {
        let row = row_result.map_err(|e| BackendError::internal(format!("Error reading row: {}", e)))?;
        let result_row = convert_row(&row, &columns);
        result.rows.push(result_row);
    }

    result.row_count = result.rows.len();
    Ok(result)
}

/// Convert a single row to a HashMap of ResultValues.
fn convert_row(row: &Row, columns: &[String]) -> HashMap<String, ResultValue> {
    let mut result = HashMap::new();

    for col in columns {
        if let Some(value) = row.get(col) {
            result.insert(col.clone(), convert_value(value));
        }
    }

    result
}

/// Convert a TypeDB Value to a ResultValue.
fn convert_value(value: &Value) -> ResultValue {
    match value {
        Value::Entity { type_name, iid } => ResultValue::Concept {
            iid: iid.clone(),
            type_name: type_name.clone(),
        },
        Value::Relation { type_name, iid } => ResultValue::Concept {
            iid: iid.clone(),
            type_name: type_name.clone(),
        },
        Value::Attribute { type_name, value } => {
            // For attributes, we include both the value and type info
            // The attribute value is the primary data
            convert_attribute_with_type(type_name, value)
        }
        Value::Type { category, label } => ResultValue::String(format!("{}:{}", category, label)),
        Value::Computed(attr) => convert_attribute_value(attr),
        Value::ThingList(items) => {
            ResultValue::List(items.iter().map(convert_value).collect())
        }
        Value::ValueList(items) => {
            ResultValue::List(items.iter().map(convert_attribute_value).collect())
        }
        Value::None => ResultValue::Null,
    }
}

/// Convert an attribute with type name to ResultValue.
/// For scenarios, we typically want just the value, not the full attribute concept.
fn convert_attribute_with_type(_type_name: &str, value: &AttributeValue) -> ResultValue {
    convert_attribute_value(value)
}

/// Convert an AttributeValue to a ResultValue.
fn convert_attribute_value(value: &AttributeValue) -> ResultValue {
    match value {
        AttributeValue::String(s) => ResultValue::String(s.clone()),
        AttributeValue::Integer(i) => ResultValue::Integer(*i),
        AttributeValue::Double(d) => ResultValue::Double(*d),
        AttributeValue::Boolean(b) => ResultValue::Boolean(*b),
        AttributeValue::Date(d) => ResultValue::Date(d.clone()),
        AttributeValue::DateTime(dt) => ResultValue::DateTime(dt.clone()),
        AttributeValue::DateTimeTZ(dt) => ResultValue::DateTime(dt.clone()),
        AttributeValue::Duration(d) => ResultValue::Duration(d.clone()),
        AttributeValue::Decimal(d) => ResultValue::Decimal(d.clone()),
        AttributeValue::Struct(s) => ResultValue::String(s.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_backend_creation() {
        let backend = EmbeddedBackend::new();
        assert_eq!(backend.name(), "embedded");
    }

    #[tokio::test]
    async fn test_backend_reset() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();
        backend.reset("test_db").await.unwrap();
        assert!(backend.db.is_some());
    }

    #[tokio::test]
    async fn test_define_schema() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();
        backend.reset("test_define").await.unwrap();

        let result = backend
            .define("define attribute name, value string; entity person, owns name;")
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_execute_insert() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();
        backend.reset("test_insert").await.unwrap();

        backend
            .define("define attribute name, value string; entity person, owns name;")
            .await
            .unwrap();

        let result = backend
            .execute("insert $p isa person, has name \"Alice\";")
            .await
            .unwrap();

        assert_eq!(result.row_count, 1);
        assert!(result.had_write);
    }

    #[tokio::test]
    async fn test_query_match() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();
        backend.reset("test_query").await.unwrap();

        backend
            .define("define attribute name, value string; entity person, owns name;")
            .await
            .unwrap();

        backend
            .execute("insert $p isa person, has name \"Alice\";")
            .await
            .unwrap();

        let result = backend
            .query("match $p isa person, has name $n;")
            .await
            .unwrap();

        assert_eq!(result.row_count, 1);
        assert!(result.columns.contains(&"p".to_string()));
        assert!(result.columns.contains(&"n".to_string()));
    }

    #[tokio::test]
    async fn test_query_empty_result() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();
        backend.reset("test_empty").await.unwrap();

        backend.define("define entity person;").await.unwrap();

        let result = backend.query("match $p isa person;").await.unwrap();

        assert_eq!(result.row_count, 0);
        assert!(result.rows.is_empty());
    }

    #[tokio::test]
    async fn test_parse_error() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();
        backend.reset("test_parse_error").await.unwrap();

        let result = backend.query("match $p isa;").await;

        assert!(result.is_err());
        if let Err(BackendError::Parse { .. }) = result {
            // Expected
        } else {
            panic!("Expected parse error, got: {:?}", result);
        }
    }

    #[tokio::test]
    async fn test_schema_error() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();
        backend.reset("test_schema_error").await.unwrap();

        let result = backend
            .define("define entity person, owns nonexistent_attribute;")
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_multiple_scenarios() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();

        // First scenario
        backend.reset("scenario_1").await.unwrap();
        backend.define("define entity a;").await.unwrap();
        backend.execute("insert $x isa a;").await.unwrap();
        let result1 = backend.query("match $x isa a;").await.unwrap();
        assert_eq!(result1.row_count, 1);
        backend.teardown().await.unwrap();

        // Second scenario - should be completely fresh
        backend.reset("scenario_2").await.unwrap();
        backend.define("define entity b;").await.unwrap();

        // Entity 'a' should not exist in this fresh database
        // Query for entity 'a' should fail since it doesn't exist
        let result2 = backend.query("match $x isa a;").await;
        // This should fail because type 'a' doesn't exist in this database
        assert!(result2.is_err(), "Type 'a' should not exist in fresh database");
    }

    #[tokio::test]
    async fn test_value_conversion_string() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();
        backend.reset("test_string").await.unwrap();

        backend
            .define("define attribute name, value string; entity person, owns name;")
            .await
            .unwrap();

        backend
            .execute("insert $p isa person, has name \"TestName\";")
            .await
            .unwrap();

        let result = backend
            .query("match $p isa person, has name $n;")
            .await
            .unwrap();

        let row = result.rows.first().unwrap();
        let name_value = row.get("n").unwrap();
        assert_eq!(name_value, &ResultValue::String("TestName".to_string()));
    }

    #[tokio::test]
    async fn test_value_conversion_integer() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();
        backend.reset("test_integer").await.unwrap();

        backend
            .define("define attribute age, value integer; entity person, owns age;")
            .await
            .unwrap();

        backend
            .execute("insert $p isa person, has age 42;")
            .await
            .unwrap();

        let result = backend
            .query("match $p isa person, has age $a;")
            .await
            .unwrap();

        let row = result.rows.first().unwrap();
        let age_value = row.get("a").unwrap();
        assert_eq!(age_value, &ResultValue::Integer(42));
    }

    #[tokio::test]
    async fn test_value_conversion_boolean() {
        let mut backend = EmbeddedBackend::new();
        backend.setup().await.unwrap();
        backend.reset("test_boolean").await.unwrap();

        backend
            .define("define attribute active, value boolean; entity account, owns active;")
            .await
            .unwrap();

        backend
            .execute("insert $a isa account, has active true;")
            .await
            .unwrap();

        let result = backend
            .query("match $a isa account, has active $v;")
            .await
            .unwrap();

        let row = result.rows.first().unwrap();
        let active_value = row.get("v").unwrap();
        assert_eq!(active_value, &ResultValue::Boolean(true));
    }
}
