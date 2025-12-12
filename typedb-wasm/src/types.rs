/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! WASM-facing types with serde support.
//!
//! These types mirror `typedb_embedded::result` types but add serde
//! serialization for JSON interchange with JavaScript.

use serde::Serialize;

/// Mirrors typedb_embedded::AttributeValue with serde support.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum WasmAttributeValue {
    String(String),
    Integer(i64),
    Double(f64),
    Boolean(bool),
    Date(String),
    DateTime(String),
    DateTimeTz(String),
    Duration(String),
    Decimal(String),
    Struct(String),
}

/// Mirrors typedb_embedded::Value with serde support.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WasmValue {
    Entity {
        #[serde(rename = "typeName")]
        type_name: String,
        iid: String,
    },
    Relation {
        #[serde(rename = "typeName")]
        type_name: String,
        iid: String,
    },
    Attribute {
        #[serde(rename = "typeName")]
        type_name: String,
        value: WasmAttributeValue,
    },
    Type {
        category: String,
        label: String,
    },
    Value(WasmAttributeValue),
    ThingList {
        items: Vec<WasmValue>,
    },
    ValueList {
        items: Vec<WasmAttributeValue>,
    },
    None,
}

/// A column value with its variable name.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmColumnValue {
    pub variable: String,
    pub value: WasmValue,
}

/// A single row in query results.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRow {
    pub values: Vec<WasmColumnValue>,
}

/// Query result with rich structured data.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub success: bool,
    pub columns: Vec<String>,
    pub rows: Vec<WasmRow>,
    pub row_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WasmError>,
}

/// Schema/write operation result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WasmError>,
}

/// Structured error with helpful information.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<ErrorLocation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

/// Error classification for the TypeScript SDK.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    ParseError,
    SchemaError,
    TypeError,
    DataError,
    TransactionError,
    InternalError,
}

/// Source location for error reporting.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorLocation {
    pub line: usize,
    pub column: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}
