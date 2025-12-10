/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

use ::concept::{error::ConceptReadError, type_::type_manager::TypeManager};
use annotations::{encode_analyzed_fetch, encode_analyzed_function, FetchStructureAnnotationsResponse};
use axum::response::{IntoResponse, Response};
use error::TypeDBError;
use http::StatusCode;
use query::analyse::AnalysedQuery;
pub use schema::AnalyzedSchemaResponse;
use serde::{Deserialize, Serialize};
use storage::snapshot::ReadableSnapshot;
use structure::{encode_analyzed_pipeline, AnalyzedFunctionResponse, AnalyzedPipelineResponse};
use typeql::common::{Span, Spannable};

use crate::service::http::message::body::JsonBody;

pub mod annotations;
pub mod schema;
pub mod structure;

// Diagnostic types for structured error reporting

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSpan {
    pub begin: usize,
    pub end: usize,
}

impl From<Span> for DiagnosticSpan {
    fn from(span: Span) -> Self {
        Self { begin: span.begin_offset, end: span.end_offset }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticPosition {
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    #[default]
    Error,
    Warning,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<DiagnosticPosition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<DiagnosticSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formatted: Option<String>,
}

/// Compute byte offset from 1-indexed line and 0-indexed column
fn line_col_to_offset(source: &str, line: usize, col: usize) -> Option<usize> {
    let mut offset = 0;
    for (i, line_str) in source.lines().enumerate() {
        if i + 1 == line {
            return Some(offset + col.min(line_str.len()));
        }
        offset += line_str.len() + 1; // +1 for newline
    }
    None
}

/// Encode typeql::Error into structured diagnostics
pub fn encode_typeql_error_diagnostics(source: &str, error: &typeql::Error) -> Vec<Diagnostic> {
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
                    Diagnostic {
                        severity: DiagnosticSeverity::Error,
                        code,
                        message,
                        position,
                        span,
                        formatted: Some(formatted_error.clone()),
                    }
                }
                TypeQLError::ReservedKeywordAsIdentifier { identifier } => {
                    let span = identifier.span.map(DiagnosticSpan::from);
                    let position = span.and_then(|s| {
                        source.line_col(Span { begin_offset: s.begin, end_offset: s.end }).map(|(begin, _)| {
                            DiagnosticPosition { line: begin.line as usize, column: begin.column as usize }
                        })
                    });
                    Diagnostic { severity: DiagnosticSeverity::Error, code, message, position, span, formatted: None }
                }
                _ => Diagnostic {
                    severity: DiagnosticSeverity::Error,
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

/// Compute position (line/column) from a span
fn span_to_position(source: &str, span: Span) -> Option<DiagnosticPosition> {
    source.line_col(span).map(|(begin, _)| DiagnosticPosition {
        line: begin.line as usize,
        column: begin.column as usize,
    })
}

/// Encode a TypeDBError (semantic error) into structured diagnostics.
/// This works with any error type that implements the TypeDBError trait,
/// including RepresentationError, AnnotationError, TypeInferenceError, QueryError, etc.
pub fn encode_typedb_error_diagnostics(source: &str, error: &dyn TypeDBError) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    // Get the most specific span available (traverses nested errors)
    let span = error.bottom_source_span();
    let diagnostic_span = span.map(DiagnosticSpan::from);
    let position = span.and_then(|s| span_to_position(source, s));

    diagnostics.push(Diagnostic {
        severity: DiagnosticSeverity::Error,
        code: format!("[{}]", error.code()),
        message: error.format_description(),
        position,
        span: diagnostic_span,
        formatted: None,
    });

    diagnostics
}

/// Encode a QueryError into diagnostics, handling the full error chain.
/// Returns diagnostics for the root cause error with span information.
pub fn encode_query_error_diagnostics(source: &str, error: &query::error::QueryError) -> Vec<Diagnostic> {
    // Use the TypeDBError trait to get the deepest span
    encode_typedb_error_diagnostics(source, error)
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeOptionsPayload {
    pub include_plan: Option<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionAnalyzePayload {
    pub options: Option<AnalyzeOptionsPayload>,
    pub query: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysedQueryResponse {
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<AnalyzedPipelineResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<AnalyzedSchemaResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub preamble: Vec<AnalyzedFunctionResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetch: Option<FetchStructureAnnotationsResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub diagnostics: Vec<Diagnostic>,
}

impl IntoResponse for AnalysedQueryResponse {
    fn into_response(self) -> Response {
        let code = StatusCode::OK;
        let body = JsonBody(self);
        (code, body).into_response()
    }
}

pub fn encode_analyzed_query(
    snapshot: &impl ReadableSnapshot,
    type_manager: &TypeManager,
    analysed_query: AnalysedQuery,
) -> Result<AnalysedQueryResponse, Box<ConceptReadError>> {
    let AnalysedQuery { source, structure, annotations } = analysed_query;
    let preamble = structure
        .preamble
        .into_iter()
        .zip(annotations.preamble.into_iter())
        .map(|(structure, annotations)| encode_analyzed_function(snapshot, type_manager, structure, annotations))
        .collect::<Result<Vec<_>, _>>()?;
    let query = encode_analyzed_pipeline(snapshot, type_manager, &structure.query, &annotations.query)?;
    let fetch = annotations
        .fetch
        .map(|fetch| {
            encode_analyzed_fetch(snapshot, type_manager, fetch)
                .map(|fields| FetchStructureAnnotationsResponse::Object { possible_fields: fields })
        })
        .transpose()?;
    Ok(AnalysedQueryResponse { source, query: Some(query), schema: None, preamble, fetch, diagnostics: vec![] })
}

#[cfg(debug_assertions)]
pub mod bdd {
    use std::collections::HashMap;

    use itertools::Itertools;

    use super::structure::AnalyzedPipelineResponse;

    pub(crate) struct FunctorContext<'a> {
        pub(super) pipeline: &'a AnalyzedPipelineResponse,
    }

    pub(crate) trait FunctorEncoded {
        fn encode_as_functor<'a>(&self, context: &FunctorContext<'a>) -> String;
    }

    pub mod functor_macros {
        macro_rules! encode_args {
            ($context:expr, { $( $arg:expr, )* } )   => {
                {
                    let arr: Vec<&dyn FunctorEncoded> = vec![ $($arg,)* ];
                    arr.into_iter().map(|s| s.encode_as_functor($context)).join(", ")
                }
            }
        }
        macro_rules! encode_functor_impl {
            ($context:expr, $func:ident $args:tt) => {
                std::format!("{}({})", std::stringify!($func), functor_macros::encode_args!($context, $args))
            };
            ($context:expr, ( $( $arg:ident, )* ) ) => {
                functor_macros::encode_args!($context, { $( $arg, )* } )
            };
        }

        macro_rules! add_ignored_fields {
            ($qualified:path : { $( $arg:ident, )* }) => { $qualified { $( $arg, )* .. } };
            ($qualified:path : ($( $arg:ident, )*)) => { $qualified ( $( $arg, )* .. ) };
        }

        macro_rules! encode_functor {
            ($context:ident, $what:ident as struct $struct_name:ident  $fields:tt) => {
                functor_macros::encode_functor!($context, $what => [ $struct_name => $struct_name $fields, ])
            };
            ($context:ident, $what:ident as struct $struct_name:ident $fields:tt named $renamed:ident ) => {
                functor_macros::encode_functor!($context, $what => [ $struct_name => $renamed $fields, ])
            };
            ($context:ident, $what:ident as enum $enum_name:ident [ $($variant:ident $fields:tt |)* ]) => {
                functor_macros::encode_functor!($context, $what => [ $( $enum_name::$variant => $variant $fields ,)* ])
            };
            ($context:ident, $what:ident => [ $($qualified:path => $func:ident $fields:tt, )* ]) => {
                match $what {
                    $( functor_macros::add_ignored_fields!($qualified : $fields) => {
                        functor_macros::encode_functor_impl!($context, $func $fields)
                    })*
                }
            };
        }

        macro_rules! impl_functor_for_impl {
            ($which:ident => |$self:ident, $context:ident| $block:block) => {
                impl FunctorEncoded for $which {
                    fn encode_as_functor<'a>($self: &Self, $context: &FunctorContext<'a>) -> String {
                        $block
                    }
                }
            };
        }

        macro_rules! impl_functor_for {
            (struct $struct_name:ident $fields:tt) => {
                functor_macros::impl_functor_for!(struct $struct_name $fields named $struct_name);
            };
            (struct $struct_name:ident $fields:tt named $renamed:ident) => {
                functor_macros::impl_functor_for_impl!($struct_name => |self, context| {
                    functor_macros::encode_functor!(context, self as struct $struct_name $fields named $renamed)
                });
            };
            (enum $enum_name:ident [ $($func:ident $fields:tt |)* ]) => {
                functor_macros::impl_functor_for_impl!($enum_name => |self, context| {
                    functor_macros::encode_functor!(context, self as enum $enum_name [ $($func $fields |)* ])
                });
            };
            (primitive $primitive:ident) => {
                functor_macros::impl_functor_for_impl!($primitive => |self, _context| { self.to_string() });
            };
        }
        macro_rules! impl_functor_for_multi {
            (|$self:ident, $context:ident| [ $( $type_name:ident => $block:block )* ]) => {
                $ (functor_macros::impl_functor_for_impl!($type_name => |$self, $context| $block); )*
            };
        }

        pub(crate) use add_ignored_fields;
        pub(crate) use encode_args;
        pub(crate) use encode_functor;
        pub(crate) use encode_functor_impl;
        pub(crate) use impl_functor_for;
        pub(crate) use impl_functor_for_impl;
        pub(crate) use impl_functor_for_multi;
    }

    functor_macros::impl_functor_for!(primitive String);
    functor_macros::impl_functor_for!(primitive u64);
    impl<T: FunctorEncoded> FunctorEncoded for Vec<T> {
        fn encode_as_functor<'a>(&self, context: &FunctorContext<'a>) -> String {
            std::format!("[{}]", self.iter().map(|v| v.encode_as_functor(context)).join(", "))
        }
    }

    impl<K: FunctorEncoded, V: FunctorEncoded> FunctorEncoded for HashMap<K, V> {
        fn encode_as_functor<'a>(&self, context: &FunctorContext<'a>) -> String {
            std::format!(
                "{{ {} }}",
                self.iter()
                    .map(|(k, v)| {
                        std::format!("{}: {}", k.encode_as_functor(context), v.encode_as_functor(context))
                    })
                    .sorted_by(|a, b| a.cmp(b))
                    .join(", ")
            )
        }
    }

    impl<T: FunctorEncoded> FunctorEncoded for Option<T> {
        fn encode_as_functor<'a>(&self, context: &FunctorContext<'a>) -> String {
            self.as_ref().map(|inner| inner.encode_as_functor(context)).unwrap_or("<NONE>".to_owned())
        }
    }
}
