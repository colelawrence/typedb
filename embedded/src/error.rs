/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Error types for the embedded TypeDB API.

use std::fmt;

/// The unified error type for all TypeDB embedded operations.
#[derive(Debug)]
pub enum Error {
    /// Error creating or opening the database.
    Database(String),
    /// Error during transaction operations.
    Transaction(String),
    /// Error parsing TypeQL query.
    Parse(String),
    /// Error executing query (schema or data).
    Query(String),
    /// Error committing transaction.
    Commit(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Database(msg) => write!(f, "Database error: {}", msg),
            Error::Transaction(msg) => write!(f, "Transaction error: {}", msg),
            Error::Parse(msg) => write!(f, "Parse error: {}", msg),
            Error::Query(msg) => write!(f, "Query error: {}", msg),
            Error::Commit(msg) => write!(f, "Commit error: {}", msg),
        }
    }
}

impl std::error::Error for Error {}

impl From<database::DatabaseOpenError> for Error {
    fn from(err: database::DatabaseOpenError) -> Self {
        Error::Database(format!("{:?}", err))
    }
}

impl From<database::transaction::TransactionError> for Error {
    fn from(err: database::transaction::TransactionError) -> Self {
        Error::Transaction(format!("{:?}", err))
    }
}

impl From<typeql::Error> for Error {
    fn from(err: typeql::Error) -> Self {
        Error::Parse(format!("{:?}", err))
    }
}

impl From<query::error::QueryError> for Error {
    fn from(err: query::error::QueryError) -> Self {
        Error::Query(format!("{:?}", err))
    }
}
