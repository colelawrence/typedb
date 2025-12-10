/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

use serde::{Deserialize, Serialize};
use typeql::{
    common::Spanned,
    query::schema::SchemaQuery,
    schema::{
        definable::{
            function::{Function, Output, ReturnStatement},
            struct_::Struct,
            type_::{Capability, CapabilityBase, Type},
            Definable,
        },
        undefinable::{self, Undefinable},
    },
};

use super::DiagnosticSpan;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AnalyzedSchemaResponse {
    Define(AnalyzedDefineResponse),
    Redefine(AnalyzedRedefineResponse),
    Undefine(AnalyzedUndefineResponse),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedDefineResponse {
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub types: Vec<AnalyzedTypeDefinition>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub structs: Vec<AnalyzedStructDefinition>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub functions: Vec<AnalyzedFunctionDefinition>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedRedefineResponse {
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub types: Vec<AnalyzedTypeDefinition>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub structs: Vec<AnalyzedStructDefinition>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub functions: Vec<AnalyzedFunctionDefinition>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedUndefineResponse {
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub items: Vec<AnalyzedUndefinable>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedTypeDefinition {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supertype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_type: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub owns: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub plays: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub relates: Vec<AnalyzedRelates>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub aliases: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub annotations: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<DiagnosticSpan>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedRelates {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specializes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedStructDefinition {
    pub name: String,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub fields: Vec<AnalyzedStructField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<DiagnosticSpan>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedStructField {
    pub name: String,
    pub value_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedFunctionDefinition {
    pub name: String,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub args: Vec<AnalyzedFunctionArg>,
    pub output: AnalyzedFunctionOutput,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<DiagnosticSpan>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedFunctionArg {
    pub name: String,
    pub value_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AnalyzedFunctionOutput {
    Stream { types: Vec<String> },
    Single { types: Vec<String> },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AnalyzedUndefinable {
    Type { label: String, span: Option<DiagnosticSpan> },
    AnnotationType { annotation: String, type_label: String, span: Option<DiagnosticSpan> },
    AnnotationCapability { annotation: String, type_label: String, capability: String, span: Option<DiagnosticSpan> },
    CapabilityType { capability: String, type_label: String, span: Option<DiagnosticSpan> },
    Specialise { specialised: String, type_label: String, relates: String, span: Option<DiagnosticSpan> },
    Function { name: String, span: Option<DiagnosticSpan> },
    Struct { name: String, span: Option<DiagnosticSpan> },
}

pub fn encode_schema_query(schema_query: &SchemaQuery) -> AnalyzedSchemaResponse {
    match schema_query {
        SchemaQuery::Define(define) => {
            AnalyzedSchemaResponse::Define(encode_definables(&define.definables))
        }
        SchemaQuery::Redefine(redefine) => {
            AnalyzedSchemaResponse::Redefine(AnalyzedRedefineResponse {
                types: encode_definables(&redefine.definables).types,
                structs: encode_definables(&redefine.definables).structs,
                functions: encode_definables(&redefine.definables).functions,
            })
        }
        SchemaQuery::Undefine(undefine) => {
            AnalyzedSchemaResponse::Undefine(encode_undefinables(&undefine.undefinables))
        }
    }
}

fn encode_definables(definables: &[Definable]) -> AnalyzedDefineResponse {
    let mut types = Vec::new();
    let mut structs = Vec::new();
    let mut functions = Vec::new();

    for definable in definables {
        match definable {
            Definable::TypeDeclaration(type_decl) => {
                types.push(encode_type_definition(type_decl));
            }
            Definable::Function(func) => {
                functions.push(encode_function_definition(func));
            }
            Definable::Struct(struct_) => {
                structs.push(encode_struct_definition(struct_));
            }
        }
    }

    AnalyzedDefineResponse { types, structs, functions }
}

fn encode_type_definition(type_decl: &Type) -> AnalyzedTypeDefinition {
    let mut supertype = None;
    let mut value_type = None;
    let mut owns = Vec::new();
    let mut plays = Vec::new();
    let mut relates = Vec::new();
    let mut aliases = Vec::new();

    for cap in &type_decl.capabilities {
        encode_capability(cap, &mut supertype, &mut value_type, &mut owns, &mut plays, &mut relates, &mut aliases);
    }

    let annotations: Vec<String> = type_decl.annotations.iter().map(|a| a.to_string()).collect();

    AnalyzedTypeDefinition {
        label: type_decl.label.to_string(),
        kind: type_decl.kind.as_ref().map(|k| k.to_string().to_lowercase()),
        supertype,
        value_type,
        owns,
        plays,
        relates,
        aliases,
        annotations,
        span: type_decl.span.map(DiagnosticSpan::from),
    }
}

fn encode_capability(
    cap: &Capability,
    supertype: &mut Option<String>,
    value_type: &mut Option<String>,
    owns: &mut Vec<String>,
    plays: &mut Vec<String>,
    relates: &mut Vec<AnalyzedRelates>,
    aliases: &mut Vec<String>,
) {
    match &cap.base {
        CapabilityBase::Sub(sub) => {
            *supertype = Some(sub.supertype_label.to_string());
        }
        CapabilityBase::ValueType(vt) => {
            *value_type = Some(vt.value_type.to_string());
        }
        CapabilityBase::Owns(o) => {
            owns.push(o.owned.to_string());
        }
        CapabilityBase::Plays(p) => {
            plays.push(p.role.to_string());
        }
        CapabilityBase::Relates(r) => {
            relates.push(AnalyzedRelates {
                role: r.related.to_string(),
                specializes: r.specialised.as_ref().map(|s| s.to_string()),
            });
        }
        CapabilityBase::Alias(a) => {
            for alias in &a.aliases {
                aliases.push(alias.to_string());
            }
        }
    }
}

fn encode_struct_definition(struct_: &Struct) -> AnalyzedStructDefinition {
    let fields: Vec<AnalyzedStructField> = struct_
        .fields
        .iter()
        .map(|f| AnalyzedStructField { name: f.key.to_string(), value_type: f.type_.to_string() })
        .collect();

    AnalyzedStructDefinition { name: struct_.ident.to_string(), fields, span: struct_.span.map(DiagnosticSpan::from) }
}

fn encode_function_definition(func: &Function) -> AnalyzedFunctionDefinition {
    let args: Vec<AnalyzedFunctionArg> = func
        .signature
        .args
        .iter()
        .map(|arg| AnalyzedFunctionArg { name: arg.var.to_string(), value_type: arg.type_.to_string() })
        .collect();

    let output = match &func.signature.output {
        Output::Stream(stream) => {
            AnalyzedFunctionOutput::Stream { types: stream.types.iter().map(|t| t.to_string()).collect() }
        }
        Output::Single(single) => {
            AnalyzedFunctionOutput::Single { types: single.types.iter().map(|t| t.to_string()).collect() }
        }
    };

    AnalyzedFunctionDefinition {
        name: func.signature.ident.to_string(),
        args,
        output,
        span: func.span.map(DiagnosticSpan::from),
    }
}

fn encode_undefinables(undefinables: &[Undefinable]) -> AnalyzedUndefineResponse {
    let items: Vec<AnalyzedUndefinable> = undefinables.iter().map(encode_undefinable).collect();
    AnalyzedUndefineResponse { items }
}

fn encode_undefinable(undefinable: &Undefinable) -> AnalyzedUndefinable {
    match undefinable {
        Undefinable::Type(label) => {
            AnalyzedUndefinable::Type { label: label.to_string(), span: label.span().map(DiagnosticSpan::from) }
        }
        Undefinable::AnnotationType(at) => AnalyzedUndefinable::AnnotationType {
            annotation: format!("@{}", at.annotation_category),
            type_label: at.type_.to_string(),
            span: at.span.map(DiagnosticSpan::from),
        },
        Undefinable::AnnotationCapability(ac) => AnalyzedUndefinable::AnnotationCapability {
            annotation: format!("@{}", ac.annotation_category),
            type_label: ac.type_.to_string(),
            capability: ac.capability.to_string(),
            span: ac.span.map(DiagnosticSpan::from),
        },
        Undefinable::CapabilityType(ct) => AnalyzedUndefinable::CapabilityType {
            capability: ct.capability.to_string(),
            type_label: ct.type_.to_string(),
            span: ct.span.map(DiagnosticSpan::from),
        },
        Undefinable::Specialise(sp) => AnalyzedUndefinable::Specialise {
            specialised: sp.specialised.to_string(),
            type_label: sp.type_.to_string(),
            relates: sp.capability.to_string(),
            span: sp.span.map(DiagnosticSpan::from),
        },
        Undefinable::Function(f) => {
            AnalyzedUndefinable::Function { name: f.ident.to_string(), span: f.span.map(DiagnosticSpan::from) }
        }
        Undefinable::Struct(s) => {
            AnalyzedUndefinable::Struct { name: s.ident.to_string(), span: s.span.map(DiagnosticSpan::from) }
        }
    }
}
