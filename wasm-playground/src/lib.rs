/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! TypeDB Browser Playground
//!
//! This crate provides WebAssembly bindings for running TypeDB entirely in the browser.
//! It wraps the `typedb-embedded` library and exposes a simple API for:
//! - Creating databases
//! - Defining schemas
//! - Inserting data
//! - Running queries
//!
//! Results are returned as rich structured JSON for beautiful visualization.

use std::sync::Arc;

use serde::Serialize;
use storage::durability_client::NoopDurabilityClient;
use wasm_bindgen::prelude::*;

// ============================================================================
// Console Logging (wasm-bindgen bindings)
// ============================================================================

#[wasm_bindgen]
extern "C" {
    /// Binding to `console.log`
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);

    /// Binding to `console.debug`
    #[wasm_bindgen(js_namespace = console, js_name = debug)]
    fn debug(s: &str);
}

/// Log a message to the browser console with a "[TypeDB]" prefix
macro_rules! console_log {
    ($($arg:tt)*) => {
        log(&format!("[TypeDB] {}", format_args!($($arg)*)));
    };
}

/// Log debug/trace level messages (more verbose)
macro_rules! console_debug {
    ($($arg:tt)*) => {
        debug(&format!("[TypeDB:debug] {}", format_args!($($arg)*)));
    };
}

// Re-export the embedded Database for internal use
use typedb_embedded::{
    AttributeValue as EmbeddedAttributeValue, Database as EmbeddedDatabase, Options,
    Value as EmbeddedValue,
};

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
/// Wraps `typedb-embedded::Database` and provides JS-friendly API.
#[wasm_bindgen]
pub struct TypeDBPlayground {
    /// The embedded database (used for schema/write/read operations)
    embedded_db: EmbeddedDatabase,
    /// Raw database access for analyze() which needs internal APIs
    raw_db: Arc<database::Database<NoopDurabilityClient>>,
}

#[wasm_bindgen]
impl TypeDBPlayground {
    /// Create a new TypeDB playground with an in-memory database.
    #[wasm_bindgen(constructor)]
    pub fn new(name: &str) -> Result<TypeDBPlayground, JsError> {
        let embedded_db = EmbeddedDatabase::new(name)
            .map_err(|e| JsError::new(&format!("Failed to create database: {}", e)))?;

        let raw_db = database::Database::create_in_memory(format!("{}_analyze", name))
            .map_err(|e| JsError::new(&format!("Failed to create analyze database: {:?}", e)))?;

        Ok(TypeDBPlayground { embedded_db, raw_db: Arc::new(raw_db) })
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
            "name": self.embedded_db.name(),
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
// Internal Implementation using typedb-embedded
// ============================================================================

impl TypeDBPlayground {
    fn define_schema_internal(&self, schema: &str) -> OperationResult {
        console_log!("define_schema() called");
        console_log!("  Input query:\n{}", schema);

        let mut tx = match self.embedded_db.transaction_schema(Options::default()) {
            Ok(tx) => {
                console_log!("  Opened schema transaction");
                tx
            }
            Err(e) => {
                console_log!("  ERROR: Failed to open schema transaction: {}", e);
                return OperationResult {
                    success: false,
                    message: "Failed to open schema transaction".to_string(),
                    row_count: None,
                    error: Some(QueryError {
                        kind: ErrorKind::TransactionError,
                        message: format!("{}", e),
                        location: None,
                        hint: Some("Try closing any other open transactions".to_string()),
                    }),
                }
            }
        };

        if let Err(e) = tx.execute(schema) {
            console_log!("  ERROR: Schema execution failed: {}", e);
            return OperationResult {
                success: false,
                message: "Schema definition failed".to_string(),
                row_count: None,
                error: Some(convert_embedded_error(e)),
            };
        }
        console_log!("  Schema executed successfully");

        match tx.commit() {
            Ok(()) => {
                console_log!("  Schema committed successfully");
                OperationResult {
                    success: true,
                    message: "Schema defined successfully".to_string(),
                    row_count: None,
                    error: None,
                }
            }
            Err(e) => {
                console_log!("  ERROR: Schema commit failed: {}", e);
                OperationResult {
                    success: false,
                    message: "Schema commit failed".to_string(),
                    row_count: None,
                    error: Some(convert_embedded_error(e)),
                }
            }
        }
    }

    fn write_internal(&self, query: &str) -> OperationResult {
        console_log!("write() called");
        console_log!("  Input query:\n{}", query);

        let tx = match self.embedded_db.transaction_write(Options::default()) {
            Ok(tx) => {
                console_log!("  Opened write transaction");
                tx
            }
            Err(e) => {
                console_log!("  ERROR: Failed to open write transaction: {}", e);
                return OperationResult {
                    success: false,
                    message: "Failed to open write transaction".to_string(),
                    row_count: None,
                    error: Some(convert_embedded_error(e)),
                }
            }
        };

        match tx.execute(query) {
            Ok(count) => {
                console_log!("  Write executed successfully: {} rows affected", count);
                OperationResult {
                    success: true,
                    message: format!("{} row{} affected", count, if count == 1 { "" } else { "s" }),
                    row_count: Some(count),
                    error: None,
                }
            }
            Err(e) => {
                console_log!("  ERROR: Write execution failed: {}", e);
                OperationResult {
                    success: false,
                    message: "Write operation failed".to_string(),
                    row_count: None,
                    error: Some(convert_embedded_error(e)),
                }
            }
        }
    }

    fn query_internal(&self, query: &str) -> QueryResult {
        console_log!("query() called");
        console_log!("  Input query:\n{}", query);

        let tx = match self.embedded_db.transaction_read(Options::default()) {
            Ok(tx) => {
                console_log!("  Opened read transaction");
                tx
            }
            Err(e) => {
                console_log!("  ERROR: Failed to open read transaction: {}", e);
                return QueryResult {
                    success: false,
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    error: Some(convert_embedded_error(e)),
                }
            }
        };

        let result_iter = match tx.query(query) {
            Ok(iter) => {
                console_log!("  Query executed, processing results...");
                iter
            }
            Err(e) => {
                console_log!("  ERROR: Query execution failed: {}", e);
                return QueryResult {
                    success: false,
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    error: Some(convert_embedded_error(e)),
                }
            }
        };

        // Get column names in the correct order from the iterator
        let columns: Vec<String> = result_iter.columns().iter().map(|k| format!("${}", k)).collect();
        console_log!("  Columns: {:?}", columns);

        let mut rows = Vec::new();

        for (row_idx, row_result) in result_iter.enumerate() {
            let row = match row_result {
                Ok(r) => r,
                Err(e) => {
                    console_log!("  ERROR: Failed to read row {}: {}", row_idx, e);
                    return QueryResult {
                        success: false,
                        columns: columns.clone(),
                        rows,
                        row_count: 0,
                        error: Some(convert_embedded_error(e)),
                    }
                }
            };

            // Log raw row data
            console_debug!("  Row {}: raw data = {:?}", row_idx, row);

            // Convert row to rich values IN COLUMN ORDER (not HashMap iteration order)
            let values: Vec<ColumnValue> = columns
                .iter()
                .map(|col_name| {
                    // Strip the leading '$' to get the variable name
                    let var_name = col_name.strip_prefix('$').unwrap_or(col_name);
                    let raw_value = row.get(var_name);
                    let value = raw_value.map(convert_embedded_value).unwrap_or(RichValue::None);
                    ColumnValue { variable: col_name.clone(), value }
                })
                .collect();

            rows.push(ResultRow { values });
        }

        console_log!("  Query returned {} rows", rows.len());

        // Log the full result as JSON for inspection
        let result = QueryResult { success: true, row_count: rows.len(), columns, rows, error: None };
        if let Ok(json) = serde_json::to_string_pretty(&result) {
            console_log!("  Result JSON:\n{}", json);
        }

        result
    }

    fn analyze_internal(&self, query_str: &str) -> AnalyzeResult {
        use database::transaction::TransactionRead;
        use options::TransactionOptions;

        console_log!("analyze() called");
        console_log!("  Input query:\n{}", query_str);

        let parsed = match typeql::parse_query(query_str) {
            Ok(parsed) => {
                console_log!("  Query parsed successfully");
                parsed
            }
            Err(e) => {
                console_log!("  ERROR: Parse failed: {:?}", e);
                let result = AnalyzeResult {
                    source: query_str.to_string(),
                    diagnostics: encode_typeql_error(query_str, &e),
                    query_type: None,
                    valid: false,
                };
                if let Ok(json) = serde_json::to_string_pretty(&result) {
                    console_log!("  Result JSON:\n{}", json);
                }
                return result;
            }
        };

        let detected = detect_query_type_internal(query_str);
        let query_type = match detected.query_type {
            DetectedQueryType::Schema => Some("schema".to_string()),
            DetectedQueryType::Write => Some("write".to_string()),
            DetectedQueryType::Read => Some("read".to_string()),
            DetectedQueryType::Unknown => None,
        };
        console_log!("  Detected query type: {:?}", query_type);

        let structure = parsed.into_structure();
        let result = match structure {
            typeql::query::QueryStructure::Pipeline(pipeline) => {
                console_log!("  Query is a pipeline, opening transaction for analysis...");
                let tx = match TransactionRead::open(self.raw_db.clone(), TransactionOptions::default()) {
                    Ok(tx) => {
                        console_log!("  Opened read transaction for analysis");
                        tx
                    }
                    Err(e) => {
                        console_log!("  ERROR: Failed to open transaction: {:?}", e);
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
                        console_log!("  Analysis succeeded: query is valid");
                        AnalyzeResult { source: query_str.to_string(), diagnostics: vec![], query_type, valid: true }
                    }
                    Err(e) => {
                        console_log!("  Analysis found errors: {:?}", e);
                        AnalyzeResult {
                            source: query_str.to_string(),
                            diagnostics: encode_query_error(query_str, &e),
                            query_type,
                            valid: false,
                        }
                    }
                }
            }
            typeql::query::QueryStructure::Schema(_) => {
                console_log!("  Query is a schema definition, marking as valid");
                AnalyzeResult { source: query_str.to_string(), diagnostics: vec![], query_type, valid: true }
            }
        };

        if let Ok(json) = serde_json::to_string_pretty(&result) {
            console_log!("  Result JSON:\n{}", json);
        }
        result
    }
}

// ============================================================================
// Value Conversion from typedb-embedded types to Rich types
// ============================================================================

fn convert_embedded_value(value: &EmbeddedValue) -> RichValue {
    match value {
        EmbeddedValue::None => RichValue::None,
        EmbeddedValue::Entity { type_name, iid } => {
            RichValue::Entity { type_name: type_name.clone(), iid: iid.clone() }
        }
        EmbeddedValue::Relation { type_name, iid } => {
            RichValue::Relation { type_name: type_name.clone(), iid: iid.clone() }
        }
        EmbeddedValue::Attribute { type_name, value } => {
            RichValue::Attribute { type_name: type_name.clone(), value: convert_embedded_attr_value(value) }
        }
        EmbeddedValue::Type { category, label } => {
            RichValue::Type { category: category.clone(), label: label.clone() }
        }
        EmbeddedValue::Computed(v) => RichValue::Value(convert_embedded_attr_value(v)),
        EmbeddedValue::ThingList(items) => {
            RichValue::ThingList { items: items.iter().map(convert_embedded_value).collect() }
        }
        EmbeddedValue::ValueList(items) => {
            RichValue::ValueList { items: items.iter().map(convert_embedded_attr_value).collect() }
        }
    }
}

fn convert_embedded_attr_value(value: &EmbeddedAttributeValue) -> AttributeValue {
    match value {
        EmbeddedAttributeValue::String(s) => AttributeValue::String(s.clone()),
        EmbeddedAttributeValue::Integer(i) => AttributeValue::Integer(*i),
        EmbeddedAttributeValue::Double(d) => AttributeValue::Double(*d),
        EmbeddedAttributeValue::Boolean(b) => AttributeValue::Boolean(*b),
        EmbeddedAttributeValue::Date(s) => AttributeValue::Date(s.clone()),
        EmbeddedAttributeValue::DateTime(s) => AttributeValue::DateTime(s.clone()),
        EmbeddedAttributeValue::DateTimeTZ(s) => AttributeValue::DateTimeTZ(s.clone()),
        EmbeddedAttributeValue::Duration(s) => AttributeValue::Duration(s.clone()),
        EmbeddedAttributeValue::Decimal(s) => AttributeValue::Decimal(s.clone()),
        EmbeddedAttributeValue::Struct(s) => AttributeValue::Struct(s.clone()),
    }
}

fn convert_embedded_error(error: typedb_embedded::Error) -> QueryError {
    let message = format!("{}", error);

    let (kind, hint) = match &error {
        typedb_embedded::Error::Database(_) => {
            (ErrorKind::InternalError, Some("Database initialization issue".to_string()))
        }
        typedb_embedded::Error::Transaction(_) => {
            (ErrorKind::TransactionError, Some("Try closing any other open transactions".to_string()))
        }
        typedb_embedded::Error::Parse(_) => (
            ErrorKind::ParseError,
            Some("Check TypeQL syntax. Common issues: missing semicolons, undefined types.".to_string()),
        ),
        typedb_embedded::Error::Query(msg) => {
            if msg.contains("Schema") || msg.contains("schema") {
                (ErrorKind::SchemaError, Some("Check that all referenced types exist".to_string()))
            } else if msg.contains("Pipeline") || msg.contains("pipeline") {
                (ErrorKind::TypeError, Some("Use the correct transaction type for this query".to_string()))
            } else {
                (ErrorKind::DataError, Some("Check that all types and attributes are defined".to_string()))
            }
        }
        typedb_embedded::Error::Commit(_) => {
            (ErrorKind::TransactionError, Some("Commit failed - transaction may have been invalidated".to_string()))
        }
    };

    let location = extract_error_location(&message);
    QueryError { kind, message, location, hint }
}

fn extract_error_location(message: &str) -> Option<ErrorLocation> {
    // Try to find line:column pattern in error message
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
        if c == '/' && chars.peek() == Some(&'*') {
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
        if let Some(rest) = trimmed.strip_prefix(keyword) {
            // Ensure it's actually the keyword and not part of another word
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
    if let Some(rest) = trimmed.strip_prefix("insert") {
        if rest.is_empty() || rest.starts_with(char::is_whitespace) {
            return QueryTypeDetection {
                query_type: DetectedQueryType::Write,
                confident: true,
                keyword: Some("insert".to_string()),
            };
        }
    }

    // Check for match-based queries
    if let Some(rest) = trimmed.strip_prefix("match") {
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
    if let Some(rest) = trimmed.strip_prefix("fetch") {
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
