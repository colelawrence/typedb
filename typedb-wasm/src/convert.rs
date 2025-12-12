/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Type conversion from typedb-embedded types to WASM types.

use typedb_embedded::{AttributeValue as EmbeddedAttr, Value as EmbeddedValue};

use crate::types::{WasmAttributeValue, WasmValue};

/// Convert embedded AttributeValue to WASM AttributeValue.
pub fn convert_attribute_value(value: &EmbeddedAttr) -> WasmAttributeValue {
    match value {
        EmbeddedAttr::String(s) => WasmAttributeValue::String(s.clone()),
        EmbeddedAttr::Integer(i) => WasmAttributeValue::Integer(*i),
        EmbeddedAttr::Double(d) => WasmAttributeValue::Double(*d),
        EmbeddedAttr::Boolean(b) => WasmAttributeValue::Boolean(*b),
        EmbeddedAttr::Date(s) => WasmAttributeValue::Date(s.clone()),
        EmbeddedAttr::DateTime(s) => WasmAttributeValue::DateTime(s.clone()),
        EmbeddedAttr::DateTimeTZ(s) => WasmAttributeValue::DateTimeTz(s.clone()),
        EmbeddedAttr::Duration(s) => WasmAttributeValue::Duration(s.clone()),
        EmbeddedAttr::Decimal(s) => WasmAttributeValue::Decimal(s.clone()),
        EmbeddedAttr::Struct(s) => WasmAttributeValue::Struct(s.clone()),
    }
}

/// Convert embedded Value to WASM Value.
pub fn convert_value(value: &EmbeddedValue) -> WasmValue {
    match value {
        EmbeddedValue::Entity { type_name, iid } => {
            WasmValue::Entity { type_name: type_name.clone(), iid: iid.clone() }
        }
        EmbeddedValue::Relation { type_name, iid } => {
            WasmValue::Relation { type_name: type_name.clone(), iid: iid.clone() }
        }
        EmbeddedValue::Attribute { type_name, value } => {
            WasmValue::Attribute { type_name: type_name.clone(), value: convert_attribute_value(value) }
        }
        EmbeddedValue::Type { category, label } => {
            WasmValue::Type { category: category.clone(), label: label.clone() }
        }
        EmbeddedValue::Computed(attr) => WasmValue::Value(convert_attribute_value(attr)),
        EmbeddedValue::ThingList(items) => WasmValue::ThingList { items: items.iter().map(convert_value).collect() },
        EmbeddedValue::ValueList(items) => {
            WasmValue::ValueList { items: items.iter().map(convert_attribute_value).collect() }
        }
        EmbeddedValue::None => WasmValue::None,
    }
}
