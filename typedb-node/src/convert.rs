/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Type conversion from typedb-embedded types to Node types.

use typedb_embedded::{
    AttributeValue as EmbeddedAttr, CardinalitySchema, EntityTypeSchema, OrderingSchema,
    OwnsSchema, PlaysSchema, RangeConstraintSchema, RelatesSchema, RelationTypeSchema,
    RoleTypeSchema, SchemaSummary, Value as EmbeddedValue, ValueConstraintSchema, ValueTypeSchema,
};

use crate::types::{
    NodeAttributeTypeSchema, NodeAttributeValue, NodeCardinalityConstraint, NodeEntityTypeSchema,
    NodeOwnsSchema, NodePlaysSchema, NodeRangeConstraint, NodeRelatesSchema,
    NodeRelationTypeSchema, NodeRoleTypeSchema, NodeSchemaSummary, NodeValue, NodeValueConstraint,
};

/// Convert embedded AttributeValue to Node AttributeValue.
pub fn convert_attribute_value(value: &EmbeddedAttr) -> NodeAttributeValue {
    match value {
        EmbeddedAttr::String(s) => NodeAttributeValue::String(s.clone()),
        EmbeddedAttr::Integer(i) => NodeAttributeValue::Integer(*i),
        EmbeddedAttr::Double(d) => NodeAttributeValue::Double(*d),
        EmbeddedAttr::Boolean(b) => NodeAttributeValue::Boolean(*b),
        EmbeddedAttr::Date(s) => NodeAttributeValue::Date(s.clone()),
        EmbeddedAttr::DateTime(s) => NodeAttributeValue::DateTime(s.clone()),
        EmbeddedAttr::DateTimeTZ(s) => NodeAttributeValue::DateTimeTz(s.clone()),
        EmbeddedAttr::Duration(s) => NodeAttributeValue::Duration(s.clone()),
        EmbeddedAttr::Decimal(s) => NodeAttributeValue::Decimal(s.clone()),
        EmbeddedAttr::Struct(s) => NodeAttributeValue::Struct(s.clone()),
    }
}

/// Convert embedded Value to Node Value.
pub fn convert_value(value: &EmbeddedValue) -> NodeValue {
    match value {
        EmbeddedValue::Entity { type_name, iid } => {
            NodeValue::Entity { type_name: type_name.clone(), iid: iid.clone() }
        }
        EmbeddedValue::Relation { type_name, iid } => {
            NodeValue::Relation { type_name: type_name.clone(), iid: iid.clone() }
        }
        EmbeddedValue::Attribute { type_name, value } => {
            NodeValue::Attribute { type_name: type_name.clone(), value: convert_attribute_value(value) }
        }
        EmbeddedValue::Type { category, label } => {
            NodeValue::Type { category: category.clone(), label: label.clone() }
        }
        EmbeddedValue::Computed(attr) => NodeValue::Value { value: convert_attribute_value(attr) },
        EmbeddedValue::ThingList(items) => NodeValue::ThingList { items: items.iter().map(convert_value).collect() },
        EmbeddedValue::ValueList(items) => {
            NodeValue::ValueList { items: items.iter().map(convert_attribute_value).collect() }
        }
        EmbeddedValue::None => NodeValue::None,
    }
}

/// Convert embedded SchemaSummary to Node SchemaSummary.
pub fn convert_schema(schema: &SchemaSummary) -> NodeSchemaSummary {
    NodeSchemaSummary {
        entity_types: schema.entity_types.iter().map(convert_entity_type).collect(),
        relation_types: schema.relation_types.iter().map(convert_relation_type).collect(),
        attribute_types: schema
            .attribute_types
            .iter()
            .map(|a| NodeAttributeTypeSchema {
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

fn convert_entity_type(entity: &EntityTypeSchema) -> NodeEntityTypeSchema {
    NodeEntityTypeSchema {
        label: entity.label.clone(),
        is_abstract: entity.is_abstract,
        supertype: entity.supertype.clone(),
        doc: entity.doc.clone(),
        owns: entity.owns.iter().map(convert_owns).collect(),
        plays: entity.plays.iter().map(convert_plays).collect(),
    }
}

fn convert_relation_type(relation: &RelationTypeSchema) -> NodeRelationTypeSchema {
    NodeRelationTypeSchema {
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

fn convert_role_type(role: &RoleTypeSchema) -> NodeRoleTypeSchema {
    NodeRoleTypeSchema {
        label: role.label.clone(),
        relation_type: role.relation_type.clone(),
        supertype: role.supertype.clone(),
        is_abstract: role.is_abstract,
        doc: role.doc.clone(),
        ordering: convert_ordering(&role.ordering),
    }
}

fn convert_owns(owns: &OwnsSchema) -> NodeOwnsSchema {
    NodeOwnsSchema {
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

fn convert_plays(plays: &PlaysSchema) -> NodePlaysSchema {
    NodePlaysSchema {
        role: plays.role.clone(),
        cardinality: convert_cardinality(&plays.cardinality),
    }
}

fn convert_relates(relates: &RelatesSchema) -> NodeRelatesSchema {
    NodeRelatesSchema {
        role: relates.role.clone(),
        is_abstract: relates.is_abstract,
        is_distinct: relates.is_distinct,
        ordering: convert_ordering(&relates.ordering),
        cardinality: convert_cardinality(&relates.cardinality),
        specializes: relates.specializes.clone(),
    }
}

fn convert_cardinality(cardinality: &CardinalitySchema) -> NodeCardinalityConstraint {
    NodeCardinalityConstraint { min: cardinality.min, max: cardinality.max }
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

fn convert_range_constraint(range: &RangeConstraintSchema) -> NodeRangeConstraint {
    NodeRangeConstraint {
        start: range.start.as_ref().map(convert_value_constraint),
        end: range.end.as_ref().map(convert_value_constraint),
    }
}

fn convert_value_constraint(value: &ValueConstraintSchema) -> NodeValueConstraint {
    NodeValueConstraint { value_type: value.value_type.clone(), value: value.value.clone() }
}
