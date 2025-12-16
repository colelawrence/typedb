/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Type conversion from typedb-embedded types to WASM types.

use typedb_embedded::{
    AttributeValue as EmbeddedAttr, CardinalitySchema, EntityTypeSchema, OrderingSchema,
    OwnsSchema, PlaysSchema, RangeConstraintSchema, RelatesSchema, RelationTypeSchema,
    RoleTypeSchema, SchemaSummary, Value as EmbeddedValue, ValueConstraintSchema, ValueTypeSchema,
};

use crate::types::{
    WasmAttributeTypeSchema, WasmAttributeValue, WasmCardinalityConstraint, WasmEntityTypeSchema,
    WasmOwnsSchema, WasmPlaysSchema, WasmRangeConstraint, WasmRelatesSchema,
    WasmRelationTypeSchema, WasmRoleTypeSchema, WasmSchemaSummary, WasmValue, WasmValueConstraint,
};

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

/// Convert embedded SchemaSummary to WASM SchemaSummary.
pub fn convert_schema(schema: &SchemaSummary) -> WasmSchemaSummary {
    WasmSchemaSummary {
        entity_types: schema.entity_types.iter().map(convert_entity_type).collect(),
        relation_types: schema.relation_types.iter().map(convert_relation_type).collect(),
        attribute_types: schema
            .attribute_types
            .iter()
            .map(|a| WasmAttributeTypeSchema {
                label: a.label.clone(),
                is_abstract: a.is_abstract,
                supertype: a.supertype.clone(),
                doc: a.doc.clone(),
                value_type: a.value_type.as_ref().map(convert_value_type),
                is_independent: a.is_independent,
                regex: a.regex.clone(),
                range: a.range.as_ref().map(convert_range_constraint),
                values: a.values.as_ref().map(|v| v.iter().map(convert_value_constraint).collect()),
            })
            .collect(),
        role_types: schema.role_types.iter().map(convert_role_type).collect(),
    }
}

fn convert_entity_type(entity: &EntityTypeSchema) -> WasmEntityTypeSchema {
    WasmEntityTypeSchema {
        label: entity.label.clone(),
        is_abstract: entity.is_abstract,
        supertype: entity.supertype.clone(),
        doc: entity.doc.clone(),
        owns: entity.owns.iter().map(convert_owns).collect(),
        plays: entity.plays.iter().map(convert_plays).collect(),
    }
}

fn convert_relation_type(relation: &RelationTypeSchema) -> WasmRelationTypeSchema {
    WasmRelationTypeSchema {
        label: relation.label.clone(),
        is_abstract: relation.is_abstract,
        supertype: relation.supertype.clone(),
        doc: relation.doc.clone(),
        cascade: relation.cascade,
        relates: relation.relates.iter().map(convert_relates).collect(),
        owns: relation.owns.iter().map(convert_owns).collect(),
        plays: relation.plays.iter().map(convert_plays).collect(),
    }
}

fn convert_role_type(role: &RoleTypeSchema) -> WasmRoleTypeSchema {
    WasmRoleTypeSchema {
        label: role.label.clone(),
        relation_type: role.relation_type.clone(),
        supertype: role.supertype.clone(),
        is_abstract: role.is_abstract,
        doc: role.doc.clone(),
        ordering: convert_ordering(&role.ordering),
    }
}

fn convert_owns(owns: &OwnsSchema) -> WasmOwnsSchema {
    WasmOwnsSchema {
        attribute: owns.attribute.clone(),
        ordering: convert_ordering(&owns.ordering),
        is_key: owns.is_key,
        is_unique: owns.is_unique,
        is_distinct: owns.is_distinct,
        cardinality: convert_cardinality(&owns.cardinality),
        regex: owns.regex.clone(),
        range: owns.range.as_ref().map(convert_range_constraint),
        values: owns.values.as_ref().map(|v| v.iter().map(convert_value_constraint).collect()),
    }
}

fn convert_plays(plays: &PlaysSchema) -> WasmPlaysSchema {
    WasmPlaysSchema {
        role: plays.role.clone(),
        cardinality: convert_cardinality(&plays.cardinality),
    }
}

fn convert_relates(relates: &RelatesSchema) -> WasmRelatesSchema {
    WasmRelatesSchema {
        role: relates.role.clone(),
        is_abstract: relates.is_abstract,
        is_distinct: relates.is_distinct,
        ordering: convert_ordering(&relates.ordering),
        cardinality: convert_cardinality(&relates.cardinality),
        specializes: relates.specializes.clone(),
    }
}

fn convert_cardinality(cardinality: &CardinalitySchema) -> WasmCardinalityConstraint {
    WasmCardinalityConstraint { min: cardinality.min, max: cardinality.max }
}

fn convert_ordering(ordering: &OrderingSchema) -> String {
    match ordering {
        OrderingSchema::Unordered => "unordered".to_string(),
        OrderingSchema::Ordered => "ordered".to_string(),
    }
}

fn convert_value_type(vt: &ValueTypeSchema) -> String {
    match vt {
        ValueTypeSchema::Boolean => "boolean".to_string(),
        ValueTypeSchema::Integer => "integer".to_string(),
        ValueTypeSchema::Double => "double".to_string(),
        ValueTypeSchema::Decimal => "decimal".to_string(),
        ValueTypeSchema::String => "string".to_string(),
        ValueTypeSchema::Date => "date".to_string(),
        ValueTypeSchema::DateTime => "datetime".to_string(),
        ValueTypeSchema::DateTimeTz => "datetime-tz".to_string(),
        ValueTypeSchema::Duration => "duration".to_string(),
        ValueTypeSchema::Struct(name) => format!("struct:{}", name),
    }
}

fn convert_range_constraint(range: &RangeConstraintSchema) -> WasmRangeConstraint {
    WasmRangeConstraint {
        start: range.start.as_ref().map(convert_value_constraint),
        end: range.end.as_ref().map(convert_value_constraint),
    }
}

fn convert_value_constraint(value: &ValueConstraintSchema) -> WasmValueConstraint {
    WasmValueConstraint { value_type: value.value_type.clone(), value: value.value.clone() }
}
