/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Schema introspection types and functions.
//!
//! This module provides structured schema information extracted from the TypeDB
//! type system, without requiring TypeQL queries.

use concept::type_::{
    annotation::{AnnotationCardinality, AnnotationRange, AnnotationValues},
    attribute_type::AttributeTypeAnnotation,
    entity_type::EntityTypeAnnotation,
    owns::{Owns, OwnsAnnotation},
    plays::Plays,
    relates::Relates,
    relation_type::{RelationType, RelationTypeAnnotation},
    role_type::RoleTypeAnnotation,
    type_manager::TypeManager,
    Capability, KindAPI, Ordering, OwnerAPI, PlayerAPI, TypeAPI,
};
use encoding::value::{value::Value, value_type::ValueType};
use storage::snapshot::ReadableSnapshot;

use crate::error::Error;

/// Extracts schema information from a transaction.
/// This is the main entry point used by `TransactionRead::schema()`.
pub fn extract_schema_from_transaction<S: ReadableSnapshot>(
    snapshot: &S,
    type_manager: &TypeManager,
) -> Result<SchemaSummary, Error> {
    extract_schema(snapshot, type_manager)
}

/// Complete schema summary for a database.
#[derive(Debug, Clone)]
pub struct SchemaSummary {
    /// All entity types in the schema.
    pub entity_types: Vec<EntityTypeSchema>,
    /// All relation types in the schema.
    pub relation_types: Vec<RelationTypeSchema>,
    /// All attribute types in the schema.
    pub attribute_types: Vec<AttributeTypeSchema>,
    /// All role types in the schema.
    pub role_types: Vec<RoleTypeSchema>,
}

/// Schema information for an entity type.
#[derive(Debug, Clone)]
pub struct EntityTypeSchema {
    /// The type label (e.g., "person").
    pub label: String,
    /// Whether this type is abstract.
    pub is_abstract: bool,
    /// Direct supertype label, if any.
    pub supertype: Option<String>,
    /// Documentation annotation (@doc).
    pub doc: Option<String>,
    /// Attributes this entity type owns.
    pub owns: Vec<OwnsSchema>,
    /// Roles this entity type plays.
    pub plays: Vec<PlaysSchema>,
}

/// Schema information for a relation type.
#[derive(Debug, Clone)]
pub struct RelationTypeSchema {
    /// The type label (e.g., "employment").
    pub label: String,
    /// Whether this type is abstract.
    pub is_abstract: bool,
    /// Direct supertype label, if any.
    pub supertype: Option<String>,
    /// Documentation annotation (@doc).
    pub doc: Option<String>,
    /// Whether deletion cascades (@cascade). Note: currently unimplemented in TypeDB.
    pub cascade: bool,
    /// Roles this relation relates.
    pub relates: Vec<RelatesSchema>,
    /// Attributes this relation type owns.
    pub owns: Vec<OwnsSchema>,
    /// Roles this relation type plays (for nested relations).
    pub plays: Vec<PlaysSchema>,
}

/// Schema information for an attribute type.
#[derive(Debug, Clone)]
pub struct AttributeTypeSchema {
    /// The type label (e.g., "name").
    pub label: String,
    /// Whether this type is abstract.
    pub is_abstract: bool,
    /// Direct supertype label, if any.
    pub supertype: Option<String>,
    /// Documentation annotation (@doc).
    pub doc: Option<String>,
    /// The value type (string, integer, double, boolean, datetime, etc.).
    pub value_type: Option<ValueTypeSchema>,
    /// Whether this attribute is independent (@independent).
    pub is_independent: bool,
    /// Regex constraint on string values (@regex).
    pub regex: Option<String>,
    /// Range constraint (@range).
    pub range: Option<RangeConstraintSchema>,
    /// Allowed values constraint (@values).
    pub values: Option<Vec<ValueConstraintSchema>>,
}

/// Schema information for a role type.
#[derive(Debug, Clone)]
pub struct RoleTypeSchema {
    /// The role label (e.g., "employer" or "employment:employer").
    pub label: String,
    /// The relation type this role belongs to.
    pub relation_type: String,
    /// Direct supertype role label, if this role specializes another.
    pub supertype: Option<String>,
    /// Whether this role is abstract.
    pub is_abstract: bool,
    /// Documentation annotation (@doc).
    pub doc: Option<String>,
    /// Ordering for this role.
    pub ordering: OrderingSchema,
}

/// Cardinality constraint.
#[derive(Debug, Clone)]
pub struct CardinalitySchema {
    /// Minimum number of occurrences.
    pub min: u64,
    /// Maximum number of occurrences, or None for unbounded.
    pub max: Option<u64>,
}

impl From<AnnotationCardinality> for CardinalitySchema {
    fn from(c: AnnotationCardinality) -> Self {
        CardinalitySchema { min: c.start(), max: c.end() }
    }
}

/// Value type representation for schema.
#[derive(Debug, Clone)]
pub enum ValueTypeSchema {
    /// Boolean value type.
    Boolean,
    /// 64-bit signed integer.
    Integer,
    /// 64-bit floating point.
    Double,
    /// Arbitrary precision decimal.
    Decimal,
    /// UTF-8 string.
    String,
    /// Date without time.
    Date,
    /// Date and time without timezone.
    DateTime,
    /// Date and time with timezone.
    DateTimeTz,
    /// Duration/interval.
    Duration,
    /// Struct type with the definition name.
    Struct(String),
}

impl ValueTypeSchema {
    fn from_value_type(vt: &ValueType) -> Self {
        match vt {
            ValueType::Boolean => ValueTypeSchema::Boolean,
            ValueType::Integer => ValueTypeSchema::Integer,
            ValueType::Double => ValueTypeSchema::Double,
            ValueType::Decimal => ValueTypeSchema::Decimal,
            ValueType::String => ValueTypeSchema::String,
            ValueType::Date => ValueTypeSchema::Date,
            ValueType::DateTime => ValueTypeSchema::DateTime,
            ValueType::DateTimeTZ => ValueTypeSchema::DateTimeTz,
            ValueType::Duration => ValueTypeSchema::Duration,
            ValueType::Struct(def_key) => ValueTypeSchema::Struct(format!("{:?}", def_key)),
        }
    }
}

/// Ownership relationship between an object type and an attribute type.
#[derive(Debug, Clone)]
pub struct OwnsSchema {
    /// The attribute type label being owned.
    pub attribute: String,
    /// The ordering of owned attributes.
    pub ordering: OrderingSchema,
    /// Whether this is a key attribute (@key).
    pub is_key: bool,
    /// Whether this attribute must be unique (@unique).
    pub is_unique: bool,
    /// Whether duplicate values are disallowed (@distinct).
    pub is_distinct: bool,
    /// Cardinality constraint.
    pub cardinality: CardinalitySchema,
    /// Regex constraint on owns.
    pub regex: Option<String>,
    /// Range constraint on owns.
    pub range: Option<RangeConstraintSchema>,
    /// Values constraint on owns.
    pub values: Option<Vec<ValueConstraintSchema>>,
}

/// Ordering for multi-valued attributes.
#[derive(Debug, Clone)]
pub enum OrderingSchema {
    /// No specific ordering - set semantics.
    Unordered,
    /// Ordered list semantics.
    Ordered,
}

impl From<Ordering> for OrderingSchema {
    fn from(o: Ordering) -> Self {
        match o {
            Ordering::Unordered => OrderingSchema::Unordered,
            Ordering::Ordered => OrderingSchema::Ordered,
        }
    }
}

/// Plays relationship between an object type and a role type.
#[derive(Debug, Clone)]
pub struct PlaysSchema {
    /// The role type label being played (e.g., "employment:employee").
    pub role: String,
    /// Cardinality constraint.
    pub cardinality: CardinalitySchema,
}

/// Relates relationship between a relation type and a role type.
#[derive(Debug, Clone)]
pub struct RelatesSchema {
    /// The role name (e.g., "employee").
    pub role: String,
    /// Whether this role is abstract.
    pub is_abstract: bool,
    /// Whether duplicate role players are disallowed.
    pub is_distinct: bool,
    /// Ordering for this role.
    pub ordering: OrderingSchema,
    /// Cardinality constraint.
    pub cardinality: CardinalitySchema,
    /// The role this specializes, if any.
    pub specializes: Option<String>,
}

/// Range constraint for attribute values.
#[derive(Debug, Clone)]
pub struct RangeConstraintSchema {
    /// Inclusive lower bound.
    pub start: Option<ValueConstraintSchema>,
    /// Inclusive upper bound.
    pub end: Option<ValueConstraintSchema>,
}

/// A typed value used in constraints.
#[derive(Debug, Clone)]
pub struct ValueConstraintSchema {
    /// The value type (e.g., "integer", "string").
    pub value_type: String,
    /// The value as a string representation.
    pub value: String,
}

/// Extract complete schema from a snapshot using the TypeManager.
pub fn extract_schema<S: ReadableSnapshot>(
    snapshot: &S,
    type_manager: &TypeManager,
) -> Result<SchemaSummary, Error> {
    let entity_types = extract_entity_types(snapshot, type_manager)?;
    let relation_types = extract_relation_types(snapshot, type_manager)?;
    let attribute_types = extract_attribute_types(snapshot, type_manager)?;
    let role_types = extract_role_types(snapshot, type_manager)?;

    Ok(SchemaSummary { entity_types, relation_types, attribute_types, role_types })
}

fn extract_entity_types<S: ReadableSnapshot>(
    snapshot: &S,
    type_manager: &TypeManager,
) -> Result<Vec<EntityTypeSchema>, Error> {
    let types = type_manager
        .get_entity_types(snapshot)
        .map_err(|e| Error::Schema(format!("Failed to get entity types: {:?}", e)))?;

    let mut result = Vec::new();
    for entity_type in types {
        let label = get_label(snapshot, type_manager, &entity_type)?;

        let is_abstract = entity_type
            .is_abstract(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to check abstract: {:?}", e)))?;

        let supertype = entity_type
            .get_supertype(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to get supertype: {:?}", e)))?
            .map(|st| get_label(snapshot, type_manager, &st))
            .transpose()?;

        // Extract @doc annotation
        let annotations = entity_type
            .get_annotations_declared(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to get annotations: {:?}", e)))?;
        let doc = annotations.iter().find_map(|a| match a {
            EntityTypeAnnotation::Doc(d) => d.description().map(|s| s.to_string()),
            _ => None,
        });

        let owns = extract_owns(snapshot, type_manager, &entity_type)?;
        let plays = extract_plays(snapshot, type_manager, &entity_type)?;

        result.push(EntityTypeSchema { label, is_abstract, supertype, doc, owns, plays });
    }

    Ok(result)
}

fn extract_relation_types<S: ReadableSnapshot>(
    snapshot: &S,
    type_manager: &TypeManager,
) -> Result<Vec<RelationTypeSchema>, Error> {
    let types = type_manager
        .get_relation_types(snapshot)
        .map_err(|e| Error::Schema(format!("Failed to get relation types: {:?}", e)))?;

    let mut result = Vec::new();
    for relation_type in types {
        let label = get_label(snapshot, type_manager, &relation_type)?;

        let is_abstract = relation_type
            .is_abstract(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to check abstract: {:?}", e)))?;

        let supertype = relation_type
            .get_supertype(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to get supertype: {:?}", e)))?
            .map(|st| get_label(snapshot, type_manager, &st))
            .transpose()?;

        // Extract @doc and @cascade annotations
        let annotations = relation_type
            .get_annotations_declared(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to get annotations: {:?}", e)))?;
        let doc = annotations.iter().find_map(|a| match a {
            RelationTypeAnnotation::Doc(d) => d.description().map(|s| s.to_string()),
            _ => None,
        });
        let cascade = annotations.iter().any(|a| matches!(a, RelationTypeAnnotation::Cascade(_)));

        let relates = extract_relates(snapshot, type_manager, &relation_type)?;
        let owns = extract_owns(snapshot, type_manager, &relation_type)?;
        let plays = extract_plays(snapshot, type_manager, &relation_type)?;

        result.push(RelationTypeSchema { label, is_abstract, supertype, doc, cascade, relates, owns, plays });
    }

    Ok(result)
}

fn extract_attribute_types<S: ReadableSnapshot>(
    snapshot: &S,
    type_manager: &TypeManager,
) -> Result<Vec<AttributeTypeSchema>, Error> {
    let types = type_manager
        .get_attribute_types(snapshot)
        .map_err(|e| Error::Schema(format!("Failed to get attribute types: {:?}", e)))?;

    let mut result = Vec::new();
    for attribute_type in types {
        let label = get_label(snapshot, type_manager, &attribute_type)?;

        let is_abstract = attribute_type
            .is_abstract(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to check abstract: {:?}", e)))?;

        let supertype = attribute_type
            .get_supertype(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to get supertype: {:?}", e)))?
            .map(|st| get_label(snapshot, type_manager, &st))
            .transpose()?;

        let value_type = attribute_type
            .get_value_type_without_source(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to get value type: {:?}", e)))?
            .map(|vt| ValueTypeSchema::from_value_type(&vt));

        // Extract annotations
        let annotations = attribute_type
            .get_annotations_declared(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to get annotations: {:?}", e)))?;

        let doc = annotations.iter().find_map(|a| match a {
            AttributeTypeAnnotation::Doc(d) => d.description().map(|s| s.to_string()),
            _ => None,
        });

        let is_independent = attribute_type
            .is_independent(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to check independent: {:?}", e)))?;

        let regex = annotations.iter().find_map(|a| match a {
            AttributeTypeAnnotation::Regex(r) => Some(r.regex().to_string()),
            _ => None,
        });

        let range = annotations.iter().find_map(|a| match a {
            AttributeTypeAnnotation::Range(r) => Some(convert_range(&r)),
            _ => None,
        });

        let values = annotations.iter().find_map(|a| match a {
            AttributeTypeAnnotation::Values(v) => Some(convert_values(&v)),
            _ => None,
        });

        result.push(AttributeTypeSchema {
            label,
            is_abstract,
            supertype,
            doc,
            value_type,
            is_independent,
            regex,
            range,
            values,
        });
    }

    Ok(result)
}

fn extract_role_types<S: ReadableSnapshot>(
    snapshot: &S,
    type_manager: &TypeManager,
) -> Result<Vec<RoleTypeSchema>, Error> {
    let types = type_manager
        .get_role_types(snapshot)
        .map_err(|e| Error::Schema(format!("Failed to get role types: {:?}", e)))?;

    let mut result = Vec::new();
    for role_type in types {
        let label = get_label(snapshot, type_manager, &role_type)?;

        let relates = role_type
            .get_relates_explicit(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to get role relation: {:?}", e)))?;

        let relation_type_label = get_label(snapshot, type_manager, &relates.relation())?;

        let supertype = role_type
            .get_supertype(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to get role supertype: {:?}", e)))?
            .map(|st| get_label(snapshot, type_manager, &st))
            .transpose()?;

        let is_abstract = role_type
            .is_abstract(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to check abstract: {:?}", e)))?;

        let ordering = role_type
            .get_ordering(snapshot, type_manager)
            .map(OrderingSchema::from)
            .unwrap_or(OrderingSchema::Unordered);

        let annotations = role_type
            .get_annotations_declared(snapshot, type_manager)
            .map_err(|e| Error::Schema(format!("Failed to get annotations: {:?}", e)))?;
        let doc = annotations.iter().find_map(|a| match a {
            RoleTypeAnnotation::Doc(d) => d.description().map(|s| s.to_string()),
        });

        result.push(RoleTypeSchema {
            label,
            relation_type: relation_type_label,
            supertype,
            is_abstract,
            doc,
            ordering,
        });
    }

    Ok(result)
}

fn extract_owns<S: ReadableSnapshot, T: OwnerAPI>(
    snapshot: &S,
    type_manager: &TypeManager,
    owner: &T,
) -> Result<Vec<OwnsSchema>, Error> {
    let owns_set = owner
        .get_owns_declared(snapshot, type_manager)
        .map_err(|e| Error::Schema(format!("Failed to get owns: {:?}", e)))?;

    let mut result = Vec::new();
    for owns in owns_set.iter() {
        result.push(extract_single_owns(snapshot, type_manager, owns)?);
    }

    Ok(result)
}

fn extract_single_owns<S: ReadableSnapshot>(
    snapshot: &S,
    type_manager: &TypeManager,
    owns: &Owns,
) -> Result<OwnsSchema, Error> {
    let attribute = get_label(snapshot, type_manager, &owns.attribute())?;

    let ordering = owns
        .get_ordering(snapshot, type_manager)
        .map(OrderingSchema::from)
        .unwrap_or(OrderingSchema::Unordered);

    let is_key = owns
        .is_key(snapshot, type_manager)
        .map_err(|e| Error::Schema(format!("Failed to check is_key: {:?}", e)))?;

    let is_unique = owns
        .get_constraint_unique(snapshot, type_manager)
        .map_err(|e| Error::Schema(format!("Failed to check is_unique: {:?}", e)))?
        .is_some();

    let is_distinct = owns
        .is_distinct(snapshot, type_manager)
        .map_err(|e| Error::Schema(format!("Failed to check is_distinct: {:?}", e)))?;

    let cardinality = owns
        .get_cardinality(snapshot, type_manager)
        .map(CardinalitySchema::from)
        .map_err(|e| Error::Schema(format!("Failed to get cardinality: {:?}", e)))?;

    let annotations = owns
        .get_annotations_declared(snapshot, type_manager)
        .map_err(|e| Error::Schema(format!("Failed to get owns annotations: {:?}", e)))?;

    let regex = annotations.iter().find_map(|a| match a {
        OwnsAnnotation::Regex(r) => Some(r.regex().to_string()),
        _ => None,
    });

    let range = annotations.iter().find_map(|a| match a {
        OwnsAnnotation::Range(r) => Some(convert_range(r)),
        _ => None,
    });

    let values = annotations.iter().find_map(|a| match a {
        OwnsAnnotation::Values(v) => Some(convert_values(v)),
        _ => None,
    });

    Ok(OwnsSchema {
        attribute,
        ordering,
        is_key,
        is_unique,
        is_distinct,
        cardinality,
        regex,
        range,
        values,
    })
}

fn extract_plays<S: ReadableSnapshot, T: PlayerAPI>(
    snapshot: &S,
    type_manager: &TypeManager,
    player: &T,
) -> Result<Vec<PlaysSchema>, Error> {
    let plays_set = player
        .get_plays_declared(snapshot, type_manager)
        .map_err(|e| Error::Schema(format!("Failed to get plays: {:?}", e)))?;

    let mut result = Vec::new();
    for plays in plays_set.iter() {
        result.push(extract_single_plays(snapshot, type_manager, plays)?);
    }

    Ok(result)
}

fn extract_single_plays<S: ReadableSnapshot>(
    snapshot: &S,
    type_manager: &TypeManager,
    plays: &Plays,
) -> Result<PlaysSchema, Error> {
    let role = get_label(snapshot, type_manager, &plays.role())?;

    let cardinality = plays
        .get_cardinality(snapshot, type_manager)
        .map(CardinalitySchema::from)
        .map_err(|e| Error::Schema(format!("Failed to get plays cardinality: {:?}", e)))?;

    Ok(PlaysSchema { role, cardinality })
}

fn extract_relates<S: ReadableSnapshot>(
    snapshot: &S,
    type_manager: &TypeManager,
    relation: &RelationType,
) -> Result<Vec<RelatesSchema>, Error> {
    let relates_set = relation
        .get_relates_declared(snapshot, type_manager)
        .map_err(|e| Error::Schema(format!("Failed to get relates: {:?}", e)))?;

    let mut result = Vec::new();
    for relates in relates_set.iter() {
        result.push(extract_single_relates(snapshot, type_manager, relates)?);
    }

    Ok(result)
}

fn extract_single_relates<S: ReadableSnapshot>(
    snapshot: &S,
    type_manager: &TypeManager,
    relates: &Relates,
) -> Result<RelatesSchema, Error> {
    let role = get_label(snapshot, type_manager, &relates.role())?;

    let is_abstract = relates
        .is_abstract(snapshot, type_manager)
        .map_err(|e| Error::Schema(format!("Failed to check relates abstract: {:?}", e)))?;

    let is_distinct = relates
        .is_distinct(snapshot, type_manager)
        .map_err(|e| Error::Schema(format!("Failed to check relates distinct: {:?}", e)))?;

    let role_type = relates.role();
    let ordering = role_type
        .get_ordering(snapshot, type_manager)
        .map(OrderingSchema::from)
        .unwrap_or(OrderingSchema::Unordered);

    let cardinality = relates
        .get_cardinality(snapshot, type_manager)
        .map(CardinalitySchema::from)
        .map_err(|e| Error::Schema(format!("Failed to get relates cardinality: {:?}", e)))?;

    let specializes = role_type
        .get_supertype(snapshot, type_manager)
        .map_err(|e| Error::Schema(format!("Failed to get role supertype: {:?}", e)))?
        .map(|st| get_label(snapshot, type_manager, &st))
        .transpose()?;

    Ok(RelatesSchema {
        role,
        is_abstract,
        is_distinct,
        ordering,
        cardinality,
        specializes,
    })
}

fn get_label<S: ReadableSnapshot, T: TypeAPI>(
    snapshot: &S,
    type_manager: &TypeManager,
    type_: &T,
) -> Result<String, Error> {
    type_
        .get_label(snapshot, type_manager)
        .map(|l| l.name().to_string())
        .map_err(|e| Error::Schema(format!("Failed to get label: {:?}", e)))
}

/// Convert a Value to a ValueConstraintSchema.
fn convert_value(value: &Value<'_>) -> ValueConstraintSchema {
    let (value_type, value_str) = match value {
        Value::Boolean(b) => ("boolean", b.to_string()),
        Value::Integer(i) => ("integer", i.to_string()),
        Value::Double(d) => ("double", d.to_string()),
        Value::Decimal(d) => ("decimal", d.to_string()),
        Value::String(s) => ("string", s.to_string()),
        Value::Date(d) => ("date", d.to_string()),
        Value::DateTime(dt) => ("datetime", dt.to_string()),
        Value::DateTimeTZ(dtz) => ("datetime-tz", dtz.to_string()),
        Value::Duration(dur) => ("duration", dur.to_string()),
        Value::Struct(s) => ("struct", format!("{:?}", s)),
    };
    ValueConstraintSchema { value_type: value_type.to_string(), value: value_str }
}

/// Convert an AnnotationRange to a RangeConstraintSchema.
fn convert_range(range: &AnnotationRange) -> RangeConstraintSchema {
    RangeConstraintSchema {
        start: range.start().as_ref().map(convert_value),
        end: range.end().as_ref().map(convert_value),
    }
}

/// Convert an AnnotationValues to a Vec<ValueConstraintSchema>.
fn convert_values(values: &AnnotationValues) -> Vec<ValueConstraintSchema> {
    values.values().iter().map(convert_value).collect()
}
