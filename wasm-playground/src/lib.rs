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
    Entity { type_name: String, iid: String },
    /// A relation instance
    Relation { type_name: String, iid: String },
    /// An attribute with its actual value
    Attribute { type_name: String, value: AttributeValue },
    /// A type (schema element)
    Type { category: String, label: String },
    /// A computed/literal value
    Value(AttributeValue),
    /// A list of things
    ThingList { items: Vec<RichValue> },
    /// A list of values
    ValueList { items: Vec<AttributeValue> },
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

/// Diagnostic for query analysis (syntax errors, semantic errors, etc.)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeDiagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<DiagnosticPosition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<DiagnosticSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formatted: Option<String>,
}

/// Position in source (line/column)
#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticPosition {
    pub line: usize,
    pub column: usize,
}

/// Span in source (byte offsets)
#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticSpan {
    pub begin: usize,
    pub end: usize,
}

/// Query analysis result
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeResult {
    pub source: String,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub diagnostics: Vec<AnalyzeDiagnostic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_type: Option<String>,
    /// True if the query is valid (no errors)
    pub valid: bool,
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

        Ok(TypeDBPlayground { database: Arc::new(database) })
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
        let detection = detect_query_type_internal(query);

        match detection.query_type {
            DetectedQueryType::Schema => self.define_schema(query),
            DetectedQueryType::Write => self.write(query),
            DetectedQueryType::Read => self.query(query),
            DetectedQueryType::Unknown => {
                // Default to read for unknown queries - let the parser give a better error
                self.query(query)
            }
        }
    }

    /// Execute a query with an explicit transaction type.
    /// Mode: "schema", "write", or "read"
    #[wasm_bindgen]
    pub fn execute_with_mode(&self, query: &str, mode: &str) -> JsValue {
        match mode {
            "schema" => self.define_schema(query),
            "write" => self.write(query),
            "read" => self.query(query),
            _ => {
                // Invalid mode - return error
                let result = OperationResult {
                    success: false,
                    message: format!("Invalid transaction mode: '{}'. Use 'schema', 'write', or 'read'.", mode),
                    row_count: None,
                    error: Some(QueryError {
                        kind: ErrorKind::TypeError,
                        message: format!("Unknown transaction mode: {}", mode),
                        location: None,
                        hint: Some("Valid modes are: 'schema' (for define/undefine/redefine), 'write' (for insert/delete), 'read' (for match/fetch)".to_string()),
                    }),
                };
                serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
            }
        }
    }

    /// Detect the query type without executing.
    /// Returns: { query_type: "schema"|"write"|"read"|"unknown", confident: bool, keyword?: string }
    #[wasm_bindgen]
    pub fn detect_query_type(&self, query: &str) -> JsValue {
        let detection = detect_query_type_internal(query);
        serde_wasm_bindgen::to_value(&detection).unwrap_or(JsValue::NULL)
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

    /// Analyze a query without executing it.
    /// Returns diagnostics (errors, warnings) and query structure information.
    #[wasm_bindgen]
    pub fn analyze(&self, query: &str) -> JsValue {
        let result = self.analyze_internal(query);
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
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
                message: format!("{} row{} affected", count, if count == 1 { "" } else { "s" }),
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
            Ok((columns, rows)) => QueryResult { success: true, row_count: rows.len(), columns, rows, error: None },
            Err(e) => QueryResult { success: false, columns: vec![], rows: vec![], row_count: 0, error: Some(e) },
        }
    }

    fn execute_schema(&self, mut tx: TransactionSchema<NoopDurabilityClient>, schema: &str) -> Result<(), QueryError> {
        let structure = typeql::parse_query(schema).map_err(|e| parse_typeql_error(e, schema))?.into_structure();

        let define = match structure {
            typeql::query::QueryStructure::Schema(schema_query) => schema_query,
            typeql::query::QueryStructure::Pipeline(_) => {
                return Err(QueryError {
                    kind: ErrorKind::TypeError,
                    message: "Pipeline queries (match/insert/delete) cannot be executed in a schema transaction"
                        .to_string(),
                    location: None,
                    hint: Some(
                        "Use write() or query() for data operations, or execute() which auto-detects query type"
                            .to_string(),
                    ),
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
            .execute_schema(snapshot, &tx.type_manager, &tx.thing_manager, &tx.function_manager, define, schema)
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

    fn execute_write(&self, tx: TransactionWrite<NoopDurabilityClient>, query: &str) -> Result<usize, QueryError> {
        let structure = typeql::parse_query(query).map_err(|e| parse_typeql_error(e, query))?.into_structure();

        let parsed = match structure {
            typeql::query::QueryStructure::Pipeline(pipeline) => pipeline,
            typeql::query::QueryStructure::Schema(_) => {
                return Err(QueryError {
                    kind: ErrorKind::TypeError,
                    message: "Schema queries (define/undefine/redefine) cannot be executed in a write transaction"
                        .to_string(),
                    location: None,
                    hint: Some(
                        "Use define_schema() for schema modifications, or execute() which auto-detects query type"
                            .to_string(),
                    ),
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

        let (mut iterator, context) =
            pipeline.into_rows_iterator(ExecutionInterrupt::new_uninterruptible()).map_err(|(e, _)| QueryError {
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
        snapshot.commit(&mut CommitProfile::DISABLED).map_err(|e| QueryError {
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
        let structure = typeql::parse_query(query).map_err(|e| parse_typeql_error(e, query))?.into_structure();

        let parsed = match structure {
            typeql::query::QueryStructure::Pipeline(pipeline) => pipeline,
            typeql::query::QueryStructure::Schema(_) => {
                return Err(QueryError {
                    kind: ErrorKind::TypeError,
                    message: "Schema queries (define/undefine/redefine) cannot be executed in a read transaction"
                        .to_string(),
                    location: None,
                    hint: Some(
                        "Use define_schema() for schema modifications, or execute() which auto-detects query type"
                            .to_string(),
                    ),
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

        let (mut iterator, context) =
            pipeline.into_rows_iterator(ExecutionInterrupt::new_uninterruptible()).map_err(|(e, _)| QueryError {
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
                    ColumnValue { variable: var_name, value: convert_variable_value(v, &context, &tx.type_manager) }
                })
                .collect();

            rows.push(ResultRow { values });
        }

        Ok((var_names, rows))
    }

    fn analyze_internal(&self, query_str: &str) -> AnalyzeResult {
        let parsed = match typeql::parse_query(query_str) {
            Ok(parsed) => parsed,
            Err(e) => {
                return AnalyzeResult {
                    source: query_str.to_string(),
                    diagnostics: encode_typeql_error(query_str, &e),
                    query_type: None,
                    valid: false,
                };
            }
        };

        let detected = detect_query_type_internal(query_str);
        let query_type = match detected.query_type {
            DetectedQueryType::Schema => Some("schema".to_string()),
            DetectedQueryType::Write => Some("write".to_string()),
            DetectedQueryType::Read => Some("read".to_string()),
            DetectedQueryType::Unknown => None,
        };

        let structure = parsed.into_structure();
        match structure {
            typeql::query::QueryStructure::Pipeline(pipeline) => {
                let tx = match TransactionRead::open(self.database.clone(), TransactionOptions::default()) {
                    Ok(tx) => tx,
                    Err(e) => {
                        return AnalyzeResult {
                            source: query_str.to_string(),
                            diagnostics: vec![AnalyzeDiagnostic {
                                severity: "error".to_string(),
                                code: "TX001".to_string(),
                                message: format!("Failed to open transaction: {:?}", e),
                                position: None,
                                span: None,
                                formatted: None,
                            }],
                            query_type,
                            valid: false,
                        };
                    }
                };

                let snapshot = tx.snapshot.clone_inner();
                match tx.query_manager.analyse(
                    snapshot,
                    &tx.type_manager,
                    tx.thing_manager.clone(),
                    &tx.function_manager,
                    &pipeline,
                    query_str,
                ) {
                    Ok(_analyzed) => {
                        AnalyzeResult { source: query_str.to_string(), diagnostics: vec![], query_type, valid: true }
                    }
                    Err(e) => AnalyzeResult {
                        source: query_str.to_string(),
                        diagnostics: encode_query_error(query_str, &e),
                        query_type,
                        valid: false,
                    },
                }
            }
            typeql::query::QueryStructure::Schema(_) => {
                AnalyzeResult { source: query_str.to_string(), diagnostics: vec![], query_type, valid: true }
            }
        }
    }
}

// ============================================================================
// Value Conversion Helpers
// ============================================================================

fn convert_variable_value(
    value: &VariableValue<'_>,
    context: &executor::pipeline::stage::ExecutionContext<storage::snapshot::ReadSnapshot<NoopDurabilityClient>>,
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

            RichValue::Type { category: category.to_string(), label }
        }

        VariableValue::Thing(thing) => convert_thing(thing, context, type_manager),

        VariableValue::Value(val) => RichValue::Value(convert_value(val)),

        VariableValue::ThingList(items) => {
            RichValue::ThingList { items: items.iter().map(|t| convert_thing(t, context, type_manager)).collect() }
        }

        VariableValue::ValueList(items) => RichValue::ValueList { items: items.iter().map(convert_value).collect() },
    }
}

fn convert_thing(
    thing: &Thing,
    context: &executor::pipeline::stage::ExecutionContext<storage::snapshot::ReadSnapshot<NoopDurabilityClient>>,
    type_manager: &concept::type_::type_manager::TypeManager,
) -> RichValue {
    let type_ = thing.type_();
    let label = type_
        .get_label(context.snapshot.as_ref(), type_manager)
        .ok()
        .map(|l| l.name().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    match thing {
        Thing::Entity(entity) => {
            RichValue::Entity { type_name: label, iid: format!("{:x}", entity.vertex().object_id().as_u64()) }
        }
        Thing::Relation(relation) => {
            RichValue::Relation { type_name: label, iid: format!("{:x}", relation.vertex().object_id().as_u64()) }
        }
        Thing::Attribute(attr) => {
            // Try to get the actual value
            let value = attr
                .get_value(context.snapshot.as_ref(), context.thing_manager.as_ref(), StorageCounters::DISABLED)
                .ok()
                .map(|v| convert_value(&v))
                .unwrap_or(AttributeValue::String("<error>".to_string()));

            RichValue::Attribute { type_name: label, value }
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
            let mut vars: Vec<_> = pos_map.iter().map(|(name, pos)| (pos.as_usize(), format!("${}", name))).collect();
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
        hint: Some(
            "Check TypeQL syntax. Common issues: missing semicolons, undefined types, or incorrect keywords."
                .to_string(),
        ),
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
                        return Some(ErrorLocation { line, column, snippet: None });
                    }
                }
            }
        }
    }
    None
}

fn clean_error_message(message: &str) -> String {
    // Remove debug formatting artifacts
    let cleaned = message.replace("Error { errors: [", "").replace("] }", "").replace("TypeQLError::", "");

    // Truncate if too long
    if cleaned.len() > 500 {
        format!("{}...", &cleaned[..500])
    } else {
        cleaned
    }
}

// ============================================================================
// Diagnostic Encoding for Analyze
// ============================================================================

fn line_col_to_offset(source: &str, line: usize, col: usize) -> Option<usize> {
    let mut offset = 0;
    for (i, line_str) in source.lines().enumerate() {
        if i + 1 == line {
            return Some(offset + col.min(line_str.len()));
        }
        offset += line_str.len() + 1;
    }
    None
}

fn encode_typeql_error(source: &str, error: &typeql::Error) -> Vec<AnalyzeDiagnostic> {
    use typeql::common::error::TypeQLError;

    error
        .errors()
        .iter()
        .map(|err| {
            let code = err.format_code();
            let message = err.message();

            match err {
                TypeQLError::SyntaxErrorDetailed { error_line_nr, error_col, formatted_error, .. } => {
                    let position = Some(DiagnosticPosition { line: *error_line_nr, column: *error_col });
                    let span = line_col_to_offset(source, *error_line_nr, *error_col)
                        .map(|begin| DiagnosticSpan { begin, end: begin + 1 });
                    AnalyzeDiagnostic {
                        severity: "error".to_string(),
                        code,
                        message,
                        position,
                        span,
                        formatted: Some(formatted_error.clone()),
                    }
                }
                _ => AnalyzeDiagnostic {
                    severity: "error".to_string(),
                    code,
                    message,
                    position: None,
                    span: None,
                    formatted: None,
                },
            }
        })
        .collect()
}

fn encode_query_error(source: &str, error: &query::error::QueryError) -> Vec<AnalyzeDiagnostic> {
    use error::TypeDBError;
    use typeql::common::Spannable;

    let span = error.bottom_source_span();
    let diagnostic_span = span.map(|s| DiagnosticSpan { begin: s.begin_offset, end: s.end_offset });
    let position = span.and_then(|s| {
        source
            .line_col(s)
            .map(|(begin, _)| DiagnosticPosition { line: begin.line as usize, column: begin.column as usize })
    });

    vec![AnalyzeDiagnostic {
        severity: "error".to_string(),
        code: format!("[{}]", error.code()),
        message: error.format_description(),
        position,
        span: diagnostic_span,
        formatted: None,
    }]
}

// ============================================================================
// Query Type Detection
// ============================================================================

/// Detected query type for transaction routing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DetectedQueryType {
    /// Schema modification (define, undefine, redefine)
    Schema,
    /// Data write (insert, delete)
    Write,
    /// Data read (match, fetch)
    Read,
    /// Unknown/ambiguous
    Unknown,
}

/// Result of query type detection
#[derive(Debug, Clone, Serialize)]
pub struct QueryTypeDetection {
    /// The detected query type
    pub query_type: DetectedQueryType,
    /// Confidence level (true = high confidence based on keyword, false = fallback/guess)
    pub confident: bool,
    /// The keyword that triggered detection (if any)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyword: Option<String>,
}

/// Strip comments from a query and return just the code content.
/// Handles both line comments (#) and block comments (/* ... */)
fn strip_comments(query: &str) -> String {
    let mut result = String::with_capacity(query.len());
    let mut chars = query.chars().peekable();
    let mut in_string = false;
    let mut string_char = '"';

    while let Some(c) = chars.next() {
        // Handle string literals - don't strip "comments" inside strings
        if !in_string && (c == '"' || c == '\'') {
            in_string = true;
            string_char = c;
            result.push(c);
            continue;
        }
        if in_string {
            result.push(c);
            if c == string_char {
                in_string = false;
            }
            continue;
        }

        // Handle line comments (#)
        if c == '#' {
            // Skip to end of line
            while let Some(&next) = chars.peek() {
                chars.next();
                if next == '\n' {
                    result.push('\n'); // Preserve newlines for formatting
                    break;
                }
            }
            continue;
        }

        // Handle block comments (/* ... */)
        if c == '/' {
            if chars.peek() == Some(&'*') {
                chars.next(); // consume '*'
                              // Skip until */
                while let Some(c2) = chars.next() {
                    if c2 == '*' && chars.peek() == Some(&'/') {
                        chars.next(); // consume '/'
                        break;
                    }
                }
                continue;
            }
        }

        result.push(c);
    }

    result
}

/// Detect the query type by analyzing the query text.
/// This strips comments first, then looks for keywords.
fn detect_query_type_internal(query: &str) -> QueryTypeDetection {
    let stripped = strip_comments(query);
    let trimmed = stripped.trim();

    // Check for schema keywords
    for keyword in &["define", "undefine", "redefine"] {
        if trimmed.starts_with(keyword) {
            // Ensure it's actually the keyword and not part of another word
            let rest = &trimmed[keyword.len()..];
            if rest.is_empty() || rest.starts_with(char::is_whitespace) || rest.starts_with(';') {
                return QueryTypeDetection {
                    query_type: DetectedQueryType::Schema,
                    confident: true,
                    keyword: Some(keyword.to_string()),
                };
            }
        }
    }

    // Check for write keywords (insert at start, or delete anywhere after match)
    if trimmed.starts_with("insert") {
        let rest = &trimmed[6..];
        if rest.is_empty() || rest.starts_with(char::is_whitespace) {
            return QueryTypeDetection {
                query_type: DetectedQueryType::Write,
                confident: true,
                keyword: Some("insert".to_string()),
            };
        }
    }

    // Check for match-based queries
    if trimmed.starts_with("match") {
        let rest = &trimmed[5..];
        if rest.is_empty() || rest.starts_with(char::is_whitespace) {
            // Check if there's a delete or insert later (making it a write query)
            // Look for delete or insert as standalone keywords
            let words: Vec<&str> = trimmed.split_whitespace().collect();
            for word in &words {
                if *word == "delete" || word.starts_with("delete;") {
                    return QueryTypeDetection {
                        query_type: DetectedQueryType::Write,
                        confident: true,
                        keyword: Some("match...delete".to_string()),
                    };
                }
                if *word == "insert" || word.starts_with("insert;") {
                    return QueryTypeDetection {
                        query_type: DetectedQueryType::Write,
                        confident: true,
                        keyword: Some("match...insert".to_string()),
                    };
                }
            }

            // Pure match query = read
            return QueryTypeDetection {
                query_type: DetectedQueryType::Read,
                confident: true,
                keyword: Some("match".to_string()),
            };
        }
    }

    // Check for fetch (always read)
    if trimmed.starts_with("fetch") {
        let rest = &trimmed[5..];
        if rest.is_empty() || rest.starts_with(char::is_whitespace) {
            return QueryTypeDetection {
                query_type: DetectedQueryType::Read,
                confident: true,
                keyword: Some("fetch".to_string()),
            };
        }
    }

    // If we can't determine, return unknown
    QueryTypeDetection { query_type: DetectedQueryType::Unknown, confident: false, keyword: None }
}

/// Initialize panic hook for better error messages in browser console.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}
