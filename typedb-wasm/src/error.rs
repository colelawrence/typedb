/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Error conversion from typedb-embedded errors to WASM errors.

use wasm_bindgen::JsError;

use crate::types::{ErrorKind, ErrorLocation, WasmError};

/// Convert a typedb-embedded error to a WasmError.
pub fn convert_error(error: &typedb_embedded::Error) -> WasmError {
    let message = format!("{}", error);

    let (kind, hint) = match error {
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
        typedb_embedded::Error::Schema(_) => {
            (ErrorKind::SchemaError, Some("Schema introspection error".to_string()))
        }
    };

    let location = extract_error_location(&message);
    WasmError { kind, message, location, hint }
}

/// Convert a typedb-embedded error to a JsError for wasm_bindgen.
pub fn convert_error_to_js(error: typedb_embedded::Error) -> JsError {
    JsError::new(&format!("{}", error))
}

/// Try to extract line/column info from an error message.
fn extract_error_location(message: &str) -> Option<ErrorLocation> {
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
