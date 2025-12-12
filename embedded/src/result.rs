/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Query result types for the embedded TypeDB API.

use std::collections::HashMap;

/// A single row from query results.
#[derive(Debug, Clone)]
pub struct Row {
    /// Variable bindings in this row.
    pub bindings: HashMap<String, Value>,
}

impl Row {
    /// Get a value by variable name.
    pub fn get(&self, variable: &str) -> Option<&Value> {
        self.bindings.get(variable)
    }
}

/// A value in query results.
#[derive(Debug, Clone)]
pub enum Value {
    /// An entity instance.
    Entity {
        /// The entity type label.
        type_name: String,
        /// Internal ID (hex string).
        iid: String,
    },
    /// A relation instance.
    Relation {
        /// The relation type label.
        type_name: String,
        /// Internal ID (hex string).
        iid: String,
    },
    /// An attribute instance.
    Attribute {
        /// The attribute type label.
        type_name: String,
        /// The attribute value.
        value: AttributeValue,
    },
    /// A type (from schema queries).
    Type {
        /// Category: "entity", "relation", "attribute", "role".
        category: String,
        /// The type label.
        label: String,
    },
    /// A computed value.
    Computed(AttributeValue),
    /// A list of things.
    ThingList(Vec<Value>),
    /// A list of values.
    ValueList(Vec<AttributeValue>),
    /// Null/empty value.
    None,
}

/// Primitive attribute values.
#[derive(Debug, Clone)]
pub enum AttributeValue {
    /// String value.
    String(String),
    /// 64-bit integer.
    Integer(i64),
    /// 64-bit floating point.
    Double(f64),
    /// Boolean value.
    Boolean(bool),
    /// Date (ISO 8601 string).
    Date(String),
    /// DateTime (ISO 8601 string).
    DateTime(String),
    /// DateTime with timezone.
    DateTimeTZ(String),
    /// Duration.
    Duration(String),
    /// Decimal number (string representation).
    Decimal(String),
    /// Struct value (debug string representation).
    Struct(String),
}

impl AttributeValue {
    /// Try to get as string.
    pub fn as_string(&self) -> Option<&str> {
        match self {
            AttributeValue::String(s) => Some(s),
            _ => None,
        }
    }

    /// Try to get as integer.
    pub fn as_integer(&self) -> Option<i64> {
        match self {
            AttributeValue::Integer(i) => Some(*i),
            _ => None,
        }
    }

    /// Try to get as double.
    pub fn as_double(&self) -> Option<f64> {
        match self {
            AttributeValue::Double(d) => Some(*d),
            _ => None,
        }
    }

    /// Try to get as boolean.
    pub fn as_boolean(&self) -> Option<bool> {
        match self {
            AttributeValue::Boolean(b) => Some(*b),
            _ => None,
        }
    }
}
