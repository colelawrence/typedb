/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! TypeDB Browser Playground
//!
//! This crate provides WebAssembly bindings for running TypeDB entirely in the browser.
//! It wraps the in-memory TypeDB database and exposes a simple API for:
//! - Creating databases
//! - Defining schemas
//! - Inserting data
//! - Running queries
//!
//! Results are returned as rich structured JSON for beautiful visualization.

use std::sync::Arc;

use answer::{variable_value::VariableValue, Thing, Type};
use concept::thing::ThingAPI;
use database::{
    transaction::{TransactionRead, TransactionSchema, TransactionWrite},
    Database,
};
use encoding::value::value::Value;
use executor::ExecutionInterrupt;
use lending_iterator::LendingIterator;
use options::TransactionOptions;
use resource::profile::{CommitProfile, StorageCounters};
use serde::Serialize;
use storage::{durability_client::NoopDurabilityClient, snapshot::CommittableSnapshot};
use wasm_bindgen::prelude::*;

// ============================================================================
// Rich Result Types for Beautiful Rendering
// ============================================================================

/// A rich value that can be rendered beautifully in the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum RichValue {
    /// An entity instance
    Entity {
        type_name: String,
        iid: String,
    },
    /// A relation instance
    Relation {
        type_name: String,
        iid: String,
    },
    /// An attribute with its actual value
    Attribute {
        type_name: String,
        value: AttributeValue,
    },
    /// A type (schema element)
    Type {
        category: String,
        label: String,
    },
    /// A computed/literal value
    Value(AttributeValue),
    /// A list of things
    ThingList {
        items: Vec<RichValue>,
    },
    /// A list of values
    ValueList {
        items: Vec<AttributeValue>,
    },
    /// Null/empty value
    None,
}

/// Attribute value types that can be serialized to JSON
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "value")]
pub enum AttributeValue {
    String(String),
    Integer(i64),
    Double(f64),
    Boolean(bool),
    Date(String),
    DateTime(String),
    DateTimeTZ(String),
    Duration(String),
    Decimal(String),
    Struct(String),
}

/// A single row in query results
#[derive(Debug, Clone, Serialize)]
pub struct ResultRow {
    /// The values in this row, keyed by variable name
    pub values: Vec<ColumnValue>,
}

/// A column value with its variable name
#[derive(Debug, Clone, Serialize)]
pub struct ColumnValue {
    pub variable: String,
    pub value: RichValue,
}

/// Query result with rich structured data
#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub success: bool,
    pub columns: Vec<String>,
    pub rows: Vec<ResultRow>,
    pub row_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<QueryError>,
}

/// Schema/write operation result
#[derive(Debug, Clone, Serialize)]
pub struct OperationResult {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<QueryError>,
}

/// Structured error with helpful information
#[derive(Debug, Clone, Serialize)]
pub struct QueryError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<ErrorLocation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub enum ErrorKind {
    ParseError,
    SchemaError,
    TypeError,
    DataError,
    TransactionError,
    InternalError,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorLocation {
    pub line: usize,
    pub column: usize,
    pub snippet: Option<String>,
}

// ============================================================================
// Main Playground Interface
// ============================================================================

/// A TypeDB database session for the browser playground.
#[wasm_bindgen]
pub struct TypeDBPlayground {
    database: Arc<Database<NoopDurabilityClient>>,
}

#[wasm_bindgen]
impl TypeDBPlayground {
    /// Create a new TypeDB playground with an in-memory database.
    #[wasm_bindgen(constructor)]
    pub fn new(name: &str) -> Result<TypeDBPlayground, JsError> {
        let database = Database::create_in_memory(name)
            .map_err(|e| JsError::new(&format!("Failed to create database: {:?}", e)))?;

        Ok(TypeDBPlayground {
            database: Arc::new(database),
        })
    }

    /// Execute a schema definition query.
    #[wasm_bindgen]
    pub fn define_schema(&self, schema: &str) -> JsValue {
        let result = self.define_schema_internal(schema);
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    /// Execute a write query (insert, delete, update).
    #[wasm_bindgen]
    pub fn write(&self, query: &str) -> JsValue {
        let result = self.write_internal(query);
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    /// Execute a read query (match, fetch) with rich results.
    #[wasm_bindgen]
    pub fn query(&self, query: &str) -> JsValue {
        let result = self.query_internal(query);
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    /// Execute any TypeQL query, automatically detecting the type.
    #[wasm_bindgen]
    pub fn execute(&self, query: &str) -> JsValue {
        let trimmed = query.trim();

        // Detect query type
        if trimmed.starts_with("define") || trimmed.starts_with("undefine") || trimmed.starts_with("redefine") {
            self.define_schema(query)
        } else if trimmed.starts_with("insert") || trimmed.contains("\ndelete") || trimmed.contains(" delete") {
            self.write(query)
        } else {
            self.query(query)
        }
    }

    /// Get database info.
    #[wasm_bindgen]
    pub fn info(&self) -> JsValue {
        let info = serde_json::json!({
            "name": self.database.name(),
            "status": "active"
        });
        serde_wasm_bindgen::to_value(&info).unwrap_or(JsValue::NULL)
    }
}

// ============================================================================
// Internal Implementation
// ============================================================================

impl TypeDBPlayground {
    fn define_schema_internal(&self, schema: &str) -> OperationResult {
        let tx = match TransactionSchema::open(self.database.clone(), TransactionOptions::default()) {
            Ok(tx) => tx,
            Err(e) => {
                return OperationResult {
                    success: false,
                    message: "Failed to open schema transaction".to_string(),
                    row_count: None,
                    error: Some(QueryError {
                        kind: ErrorKind::TransactionError,
                        message: format!("{:?}", e),
                        location: None,
                        hint: Some("Try closing any other open transactions".to_string()),
                    }),
                }
            }
        };

        match self.execute_schema(tx, schema) {
            Ok(()) => OperationResult {
                success: true,
                message: "Schema defined successfully".to_string(),
                row_count: None,
                error: None,
            },
            Err(e) => OperationResult {
                success: false,
                message: "Schema definition failed".to_string(),
                row_count: None,
                error: Some(e),
            },
        }
    }

    fn write_internal(&self, query: &str) -> OperationResult {
        let tx = match TransactionWrite::open(self.database.clone(), TransactionOptions::default()) {
            Ok(tx) => tx,
            Err(e) => {
                return OperationResult {
                    success: false,
                    message: "Failed to open write transaction".to_string(),
                    row_count: None,
                    error: Some(QueryError {
                        kind: ErrorKind::TransactionError,
                        message: format!("{:?}", e),
                        location: None,
                        hint: None,
                    }),
                }
            }
        };

        match self.execute_write(tx, query) {
            Ok(count) => OperationResult {
                success: true,
                message: format!(
                    "{} row{} affected",
                    count,
                    if count == 1 { "" } else { "s" }
                ),
                row_count: Some(count),
                error: None,
            },
            Err(e) => OperationResult {
                success: false,
                message: "Write operation failed".to_string(),
                row_count: None,
                error: Some(e),
            },
        }
    }

    fn query_internal(&self, query: &str) -> QueryResult {
        let tx = match TransactionRead::open(self.database.clone(), TransactionOptions::default()) {
            Ok(tx) => tx,
            Err(e) => {
                return QueryResult {
                    success: false,
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    error: Some(QueryError {
                        kind: ErrorKind::TransactionError,
                        message: format!("{:?}", e),
                        location: None,
                        hint: None,
                    }),
                }
            }
        };

        match self.execute_query(&tx, query) {
            Ok((columns, rows)) => QueryResult {
                success: true,
                row_count: rows.len(),
                columns,
                rows,
                error: None,
            },
            Err(e) => QueryResult {
                success: false,
                columns: vec![],
                rows: vec![],
                row_count: 0,
                error: Some(e),
            },
        }
    }

    fn execute_schema(
        &self,
        mut tx: TransactionSchema<NoopDurabilityClient>,
        schema: &str,
    ) -> Result<(), QueryError> {
        let structure = typeql::parse_query(schema)
            .map_err(|e| parse_typeql_error(e, schema))?
            .into_structure();

        let define = match structure {
            typeql::query::QueryStructure::Schema(schema_query) => schema_query,
            typeql::query::QueryStructure::Pipeline(_) => {
                return Err(QueryError {
                    kind: ErrorKind::TypeError,
                    message: "Pipeline queries (match/insert/delete) cannot be executed in a schema transaction".to_string(),
                    location: None,
                    hint: Some("Use write() or query() for data operations, or execute() which auto-detects query type".to_string()),
                });
            }
        };

        let snapshot = tx.snapshot.as_mut().ok_or_else(|| QueryError {
            kind: ErrorKind::InternalError,
            message: "Snapshot not available".to_string(),
            location: None,
            hint: None,
        })?;

        tx.query_manager
            .execute_schema(
                snapshot,
                &tx.type_manager,
                &tx.thing_manager,
                &tx.function_manager,
                define,
                schema,
            )
            .map_err(|e| QueryError {
                kind: ErrorKind::SchemaError,
                message: format!("{:?}", e),
                location: None,
                hint: Some("Check that all referenced types exist".to_string()),
            })?;

        let (_, result) = tx.commit();
        result.map_err(|e| QueryError {
            kind: ErrorKind::TransactionError,
            message: format!("Commit failed: {:?}", e),
            location: None,
            hint: None,
        })
    }

    fn execute_write(
        &self,
        tx: TransactionWrite<NoopDurabilityClient>,
        query: &str,
    ) -> Result<usize, QueryError> {
        let structure = typeql::parse_query(query)
            .map_err(|e| parse_typeql_error(e, query))?
            .into_structure();

        let parsed = match structure {
            typeql::query::QueryStructure::Pipeline(pipeline) => pipeline,
            typeql::query::QueryStructure::Schema(_) => {
                return Err(QueryError {
                    kind: ErrorKind::TypeError,
                    message: "Schema queries (define/undefine/redefine) cannot be executed in a write transaction".to_string(),
                    location: None,
                    hint: Some("Use define_schema() for schema modifications, or execute() which auto-detects query type".to_string()),
                });
            }
        };

        let snapshot = tx.snapshot.into_inner();
        let pipeline = tx
            .query_manager
            .prepare_write_pipeline(
                snapshot,
                &tx.type_manager,
                tx.thing_manager.clone(),
                &tx.function_manager,
                &parsed,
                query,
            )
            .map_err(|(_, e)| QueryError {
                kind: ErrorKind::TypeError,
                message: format!("{:?}", e),
                location: None,
                hint: Some("Check that all types and attributes are defined in the schema".to_string()),
            })?;

        let (mut iterator, context) = pipeline
            .into_rows_iterator(ExecutionInterrupt::new_uninterruptible())
            .map_err(|(e, _)| QueryError {
                kind: ErrorKind::DataError,
                message: format!("{:?}", e),
                location: None,
                hint: None,
            })?;

        let mut count = 0;
        while let Some(result) = iterator.next() {
            result.map_err(|e| QueryError {
                kind: ErrorKind::DataError,
                message: format!("{:?}", e),
                location: None,
                hint: None,
            })?;
            count += 1;
        }

        let snapshot = Arc::try_unwrap(context.snapshot).map_err(|_| QueryError {
            kind: ErrorKind::InternalError,
            message: "Snapshot still in use".to_string(),
            location: None,
            hint: None,
        })?;
        snapshot
            .commit(&mut CommitProfile::DISABLED)
            .map_err(|e| QueryError {
                kind: ErrorKind::TransactionError,
                message: format!("Commit failed: {:?}", e),
                location: None,
                hint: None,
            })?;

        Ok(count)
    }

    fn execute_query(
        &self,
        tx: &TransactionRead<NoopDurabilityClient>,
        query: &str,
    ) -> Result<(Vec<String>, Vec<ResultRow>), QueryError> {
        let structure = typeql::parse_query(query)
            .map_err(|e| parse_typeql_error(e, query))?
            .into_structure();

        let parsed = match structure {
            typeql::query::QueryStructure::Pipeline(pipeline) => pipeline,
            typeql::query::QueryStructure::Schema(_) => {
                return Err(QueryError {
                    kind: ErrorKind::TypeError,
                    message: "Schema queries (define/undefine/redefine) cannot be executed in a read transaction".to_string(),
                    location: None,
                    hint: Some("Use define_schema() for schema modifications, or execute() which auto-detects query type".to_string()),
                });
            }
        };

        let snapshot = tx.snapshot.clone_inner();
        let pipeline = tx
            .query_manager
            .prepare_read_pipeline(
                snapshot,
                &tx.type_manager,
                tx.thing_manager.clone(),
                &tx.function_manager,
                &parsed,
                query,
            )
            .map_err(|e| QueryError {
                kind: ErrorKind::TypeError,
                message: format!("{:?}", e),
                location: None,
                hint: Some("Check that all types exist in the schema".to_string()),
            })?;

        // Get variable names from the pipeline's rows_positions
        let var_names = extract_variable_names_from_positions(pipeline.rows_positions());

        let (mut iterator, context) = pipeline
            .into_rows_iterator(ExecutionInterrupt::new_uninterruptible())
            .map_err(|(e, _)| QueryError {
                kind: ErrorKind::DataError,
                message: format!("{:?}", e),
                location: None,
                hint: None,
            })?;

        let mut rows = Vec::new();
        while let Some(result) = iterator.next() {
            let row = result.map_err(|e| QueryError {
                kind: ErrorKind::DataError,
                message: format!("{:?}", e),
                location: None,
                hint: None,
            })?;

            // Convert each value to a rich representation
            let values: Vec<ColumnValue> = row
                .row()
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let var_name = var_names.get(i).cloned().unwrap_or_else(|| format!("${}", i));
                    ColumnValue {
                        variable: var_name,
                        value: convert_variable_value(v, &context, &tx.type_manager),
                    }
                })
                .collect();

            rows.push(ResultRow { values });
        }

        Ok((var_names, rows))
    }
}

// ============================================================================
// Value Conversion Helpers
// ============================================================================

fn convert_variable_value(
    value: &VariableValue<'_>,
    context: &executor::pipeline::stage::ExecutionContext<
        storage::snapshot::ReadSnapshot<NoopDurabilityClient>,
    >,
    type_manager: &concept::type_::type_manager::TypeManager,
) -> RichValue {
    match value {
        VariableValue::None => RichValue::None,

        VariableValue::Type(ty) => {
            let label = ty
                .get_label(context.snapshot.as_ref(), type_manager)
                .ok()
                .map(|l| l.name().to_string())
                .unwrap_or_else(|| "unknown".to_string());

            let category = match ty {
                Type::Entity(_) => "entity",
                Type::Relation(_) => "relation",
                Type::Attribute(_) => "attribute",
                Type::RoleType(_) => "role",
            };

            RichValue::Type {
                category: category.to_string(),
                label,
            }
        }

        VariableValue::Thing(thing) => convert_thing(thing, context, type_manager),

        VariableValue::Value(val) => RichValue::Value(convert_value(val)),

        VariableValue::ThingList(items) => RichValue::ThingList {
            items: items
                .iter()
                .map(|t| convert_thing(t, context, type_manager))
                .collect(),
        },

        VariableValue::ValueList(items) => RichValue::ValueList {
            items: items.iter().map(convert_value).collect(),
        },
    }
}

fn convert_thing(
    thing: &Thing,
    context: &executor::pipeline::stage::ExecutionContext<
        storage::snapshot::ReadSnapshot<NoopDurabilityClient>,
    >,
    type_manager: &concept::type_::type_manager::TypeManager,
) -> RichValue {
    let type_ = thing.type_();
    let label = type_
        .get_label(context.snapshot.as_ref(), type_manager)
        .ok()
        .map(|l| l.name().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    match thing {
        Thing::Entity(entity) => RichValue::Entity {
            type_name: label,
            iid: format!("{:x}", entity.vertex().object_id().as_u64()),
        },
        Thing::Relation(relation) => RichValue::Relation {
            type_name: label,
            iid: format!("{:x}", relation.vertex().object_id().as_u64()),
        },
        Thing::Attribute(attr) => {
            // Try to get the actual value
            let value = attr
                .get_value(
                    context.snapshot.as_ref(),
                    context.thing_manager.as_ref(),
                    StorageCounters::DISABLED,
                )
                .ok()
                .map(|v| convert_value(&v))
                .unwrap_or(AttributeValue::String("<error>".to_string()));

            RichValue::Attribute {
                type_name: label,
                value,
            }
        }
    }
}

fn convert_value(value: &Value<'_>) -> AttributeValue {
    match value {
        Value::Boolean(b) => AttributeValue::Boolean(*b),
        Value::Integer(i) => AttributeValue::Integer(*i),
        Value::Double(d) => AttributeValue::Double(*d),
        Value::Decimal(d) => AttributeValue::Decimal(format!("{}", d)),
        Value::Date(d) => AttributeValue::Date(d.to_string()),
        Value::DateTime(dt) => AttributeValue::DateTime(dt.to_string()),
        Value::DateTimeTZ(dt) => AttributeValue::DateTimeTZ(dt.to_string()),
        Value::Duration(d) => AttributeValue::Duration(format!("{:?}", d)),
        Value::String(s) => AttributeValue::String(s.to_string()),
        Value::Struct(s) => AttributeValue::Struct(format!("{:?}", s)),
    }
}

fn extract_variable_names_from_positions(
    positions: Option<&std::collections::HashMap<String, compiler::VariablePosition>>,
) -> Vec<String> {
    match positions {
        Some(pos_map) => {
            // Sort by position index to get variable names in column order
            let mut vars: Vec<_> = pos_map
                .iter()
                .map(|(name, pos)| (pos.as_usize(), format!("${}", name)))
                .collect();
            vars.sort_by_key(|(pos, _)| *pos);
            vars.into_iter().map(|(_, name)| name).collect()
        }
        None => vec![],
    }
}

fn parse_typeql_error(error: typeql::Error, _query: &str) -> QueryError {
    // Extract useful info from TypeQL errors
    let message = format!("{:?}", error);

    // Try to extract line/column from error message
    let location = extract_error_location(&message);

    QueryError {
        kind: ErrorKind::ParseError,
        message: clean_error_message(&message),
        location,
        hint: Some("Check TypeQL syntax. Common issues: missing semicolons, undefined types, or incorrect keywords.".to_string()),
    }
}

fn extract_error_location(message: &str) -> Option<ErrorLocation> {
    // Try to find line:column pattern in error message
    // TypeQL errors often contain "Near X:Y" or similar
    if let Some(near_idx) = message.find("Near ") {
        let rest = &message[near_idx + 5..];
        if let Some(colon_idx) = rest.find(':') {
            if let Ok(line) = rest[..colon_idx].trim().parse::<usize>() {
                let after_colon = &rest[colon_idx + 1..];
                if let Some(end) = after_colon.find(|c: char| !c.is_ascii_digit()) {
                    if let Ok(column) = after_colon[..end].parse::<usize>() {
                        return Some(ErrorLocation {
                            line,
                            column,
                            snippet: None,
                        });
                    }
                }
            }
        }
    }
    None
}

fn clean_error_message(message: &str) -> String {
    // Remove debug formatting artifacts
    let cleaned = message
        .replace("Error { errors: [", "")
        .replace("] }", "")
        .replace("TypeQLError::", "");

    // Truncate if too long
    if cleaned.len() > 500 {
        format!("{}...", &cleaned[..500])
    } else {
        cleaned
    }
}

/// Initialize panic hook for better error messages in browser console.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}
