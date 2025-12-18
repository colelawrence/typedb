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
    Value {
        value: WasmAttributeValue,
    },
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

// ============================================================================
// Schema Introspection Types
// ============================================================================

/// Complete schema summary for a database.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSchemaSummary {
    pub entity_types: Vec<WasmEntityTypeSchema>,
    pub relation_types: Vec<WasmRelationTypeSchema>,
    pub attribute_types: Vec<WasmAttributeTypeSchema>,
    pub role_types: Vec<WasmRoleTypeSchema>,
}

/// Schema information for an entity type.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmEntityTypeSchema {
    pub label: String,
    pub is_abstract: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supertype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    pub owns: Vec<WasmOwnsSchema>,
    pub plays: Vec<WasmPlaysSchema>,
}

/// Schema information for a relation type.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRelationTypeSchema {
    pub label: String,
    pub is_abstract: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supertype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    pub cascade: bool,
    pub relates: Vec<WasmRelatesSchema>,
    pub owns: Vec<WasmOwnsSchema>,
    pub plays: Vec<WasmPlaysSchema>,
}

/// Schema information for an attribute type.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmAttributeTypeSchema {
    pub label: String,
    pub is_abstract: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supertype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_type: Option<String>,
    pub is_independent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub regex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<WasmRangeConstraint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<WasmValueConstraint>>,
}

/// Schema information for a role type.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRoleTypeSchema {
    pub label: String,
    pub relation_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supertype: Option<String>,
    pub is_abstract: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    pub ordering: String,
}

/// Cardinality constraint.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmCardinalityConstraint {
    pub min: u64,
    pub max: Option<u64>,
}

/// Ownership relationship.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmOwnsSchema {
    pub attribute: String,
    pub ordering: String,
    pub is_key: bool,
    pub is_unique: bool,
    pub is_distinct: bool,
    pub cardinality: WasmCardinalityConstraint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub regex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<WasmRangeConstraint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<WasmValueConstraint>>,
}

/// Plays relationship.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmPlaysSchema {
    pub role: String,
    pub cardinality: WasmCardinalityConstraint,
}

/// Relates relationship.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRelatesSchema {
    pub role: String,
    pub is_abstract: bool,
    pub is_distinct: bool,
    pub ordering: String,
    pub cardinality: WasmCardinalityConstraint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specializes: Option<String>,
}

/// Range constraint for attribute values.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRangeConstraint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<WasmValueConstraint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<WasmValueConstraint>,
}

/// A typed value used in constraints.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmValueConstraint {
    #[serde(rename = "type")]
    pub value_type: String,
    pub value: String,
}

/// Schema introspection result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<WasmSchemaSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WasmError>,
}
