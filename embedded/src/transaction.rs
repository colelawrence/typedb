/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Transaction types for the embedded TypeDB API.

use std::{collections::HashMap, sync::Arc};

use answer::{variable_value::VariableValue, Thing, Type};
use concept::thing::ThingAPI;
use encoding::value::value::Value as EncodingValue;
use executor::ExecutionInterrupt;
use lending_iterator::LendingIterator;
use options::TransactionOptions;
use resource::profile::{CommitProfile, StorageCounters};
use storage::{durability_client::NoopDurabilityClient, snapshot::CommittableSnapshot};

use crate::{
    error::Error,
    result::{AttributeValue, Row, Value},
    schema::{extract_schema_from_transaction, SchemaSummary},
};

type InnerDatabase = database::Database<NoopDurabilityClient>;
type InnerTransactionRead = database::transaction::TransactionRead<NoopDurabilityClient>;
type InnerTransactionWrite = database::transaction::TransactionWrite<NoopDurabilityClient>;
type InnerTransactionSchema = database::transaction::TransactionSchema<NoopDurabilityClient>;

/// A read-only transaction.
///
/// Use this to execute `match` and `fetch` queries without modifying data.
pub struct TransactionRead {
    inner: InnerTransactionRead,
}

impl TransactionRead {
    pub(crate) fn open(database: Arc<InnerDatabase>, options: TransactionOptions) -> Result<Self, Error> {
        let inner = InnerTransactionRead::open(database, options)?;
        Ok(Self { inner })
    }

    /// Execute a read query and return results.
    ///
    /// Supports `match` and `fetch` queries.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use typedb_embedded::{Database, Options};
    /// # let db = Database::new("mydb").unwrap();
    /// # let tx = db.transaction_read(Options::default()).unwrap();
    /// for row in tx.query("match $p isa person, has name $n;")? {
    ///     let row = row?;
    ///     println!("{:?}", row.get("n"));
    /// }
    /// # Ok::<(), typedb_embedded::Error>(())
    /// ```
    pub fn query(&self, query: &str) -> Result<QueryResultIterator, Error> {
        execute_read_query(&self.inner, query)
    }

    /// Get the complete schema of the database.
    ///
    /// Returns structured information about all entity types, relation types,
    /// attribute types, and role types, including their supertypes, owned
    /// attributes, played roles, and value types.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use typedb_embedded::{Database, Options};
    /// # let db = Database::new("mydb").unwrap();
    /// # let tx = db.transaction_read(Options::default()).unwrap();
    /// let schema = tx.schema()?;
    /// for entity in &schema.entity_types {
    ///     println!("Entity: {}", entity.label);
    /// }
    /// # Ok::<(), typedb_embedded::Error>(())
    /// ```
    pub fn schema(&self) -> Result<SchemaSummary, Error> {
        let snapshot = self.inner.snapshot.as_ref();
        extract_schema_from_transaction(snapshot, &self.inner.type_manager)
    }

    /// Close the transaction without committing.
    ///
    /// Read transactions don't need explicit commits, but calling this
    /// releases resources immediately.
    pub fn close(self) {
        drop(self.inner);
    }
}

/// A write transaction for data modifications.
///
/// Use this to execute `insert`, `delete`, and `update` queries.
/// The transaction auto-commits after execution.
///
/// # Note
///
/// Due to internal design constraints, each write transaction executes
/// a single query and commits. For multiple writes, open multiple transactions.
pub struct TransactionWrite {
    inner: InnerTransactionWrite,
}

impl TransactionWrite {
    pub(crate) fn open(database: Arc<InnerDatabase>, options: TransactionOptions) -> Result<Self, Error> {
        let inner = InnerTransactionWrite::open(database, options)?;
        Ok(Self { inner })
    }

    /// Execute a write query and commit.
    ///
    /// Supports `insert`, `delete`, and `update` queries.
    /// Returns the number of rows affected.
    ///
    /// This method consumes the transaction. The changes are committed
    /// automatically on success.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use typedb_embedded::{Database, Options};
    /// # let db = Database::new("mydb").unwrap();
    /// let tx = db.transaction_write(Options::default())?;
    /// let count = tx.execute("insert $p isa person, has name \"Alice\";")?;
    /// println!("Inserted {} rows", count);
    /// # Ok::<(), typedb_embedded::Error>(())
    /// ```
    pub fn execute(self, query: &str) -> Result<usize, Error> {
        execute_write_query(self.inner, query)
    }
}

/// A schema transaction for schema modifications.
///
/// Use this to execute `define`, `undefine`, and `redefine` queries.
/// Call [`commit`](TransactionSchema::commit) to persist changes.
pub struct TransactionSchema {
    inner: Option<InnerTransactionSchema>,
}

impl TransactionSchema {
    pub(crate) fn open(database: Arc<InnerDatabase>, options: TransactionOptions) -> Result<Self, Error> {
        let inner = InnerTransactionSchema::open(database, options)?;
        Ok(Self { inner: Some(inner) })
    }

    /// Execute a schema query.
    ///
    /// Supports `define`, `undefine`, and `redefine` queries.
    /// Can be called multiple times before committing.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use typedb_embedded::{Database, Options};
    /// # let db = Database::new("mydb").unwrap();
    /// let mut tx = db.transaction_schema(Options::default())?;
    /// tx.execute("define entity person owns name; attribute name value string;")?;
    /// tx.commit()?;
    /// # Ok::<(), typedb_embedded::Error>(())
    /// ```
    pub fn execute(&mut self, query: &str) -> Result<(), Error> {
        let tx = self.inner.as_mut().ok_or_else(|| Error::Transaction("Transaction already consumed".to_string()))?;
        execute_schema_query(tx, query)
    }

    /// Commit the transaction, persisting all schema changes.
    ///
    /// After calling this, the transaction is consumed and cannot be used.
    ///
    /// # Errors
    ///
    /// Returns an error if the commit fails (e.g., due to schema violations).
    pub fn commit(mut self) -> Result<(), Error> {
        let tx = self.inner.take().ok_or_else(|| Error::Transaction("Transaction already consumed".to_string()))?;
        let (_, result) = tx.commit();
        result.map_err(|e| Error::Commit(format!("{:?}", e)))
    }

    /// Roll back the transaction, discarding all changes.
    pub fn rollback(mut self) -> Result<(), Error> {
        self.inner.take();
        Ok(())
    }
}

impl Drop for TransactionSchema {
    fn drop(&mut self) {
        // If inner is still Some, the transaction was not committed - auto-rollback
    }
}

/// Iterator over query results.
#[derive(Debug)]
pub struct QueryResultIterator {
    rows: Vec<Row>,
    position: usize,
    columns: Vec<String>,
}

impl QueryResultIterator {
    fn new(rows: Vec<Row>, columns: Vec<String>) -> Self {
        Self { rows, position: 0, columns }
    }

    /// Get the column names in their correct order.
    ///
    /// This is important because `Row.bindings` is a HashMap and
    /// doesn't preserve insertion order. Use these column names
    /// to iterate through row values in the correct order.
    pub fn columns(&self) -> &[String] {
        &self.columns
    }
}

impl Iterator for QueryResultIterator {
    type Item = Result<Row, Error>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.position >= self.rows.len() {
            return None;
        }
        let row = self.rows[self.position].clone();
        self.position += 1;
        Some(Ok(row))
    }
}

impl ExactSizeIterator for QueryResultIterator {
    fn len(&self) -> usize {
        self.rows.len() - self.position
    }
}

// ============================================================================
// Internal Query Execution
// ============================================================================

fn execute_read_query(tx: &InnerTransactionRead, query: &str) -> Result<QueryResultIterator, Error> {
    let parsed = typeql::parse_query(query)?;
    let structure = parsed.into_structure();

    let pipeline_query = match structure {
        typeql::query::QueryStructure::Pipeline(p) => p,
        typeql::query::QueryStructure::Schema(_) => {
            return Err(Error::Query(
                "Schema queries cannot be executed in a read transaction. Use transaction_schema().".to_string(),
            ));
        }
    };

    let snapshot = tx.snapshot.clone_inner();
    let pipeline = tx
        .query_manager
        .prepare_read_pipeline(
            snapshot,
            &tx.type_manager,
            tx.thing_manager.clone(),
            &tx.function_manager,
            &pipeline_query,
            query,
        )
        .map_err(|e| Error::Query(format!("{:?}", e)))?;

    // Extract named output variables with their positions
    // The positions are indices into the row array
    let named_positions = extract_variable_positions(pipeline.rows_positions());
    let var_names: Vec<String> = named_positions.iter().map(|(name, _)| name.clone()).collect();

    let (mut iterator, context) = pipeline
        .into_rows_iterator(ExecutionInterrupt::new_uninterruptible())
        .map_err(|(e, _)| Error::Query(format!("{:?}", e)))?;

    let mut rows = Vec::new();
    while let Some(result) = iterator.next() {
        let row_data = result.map_err(|e| Error::Query(format!("{:?}", e)))?;

        // Only extract the named output variables using their actual positions
        let mut bindings = HashMap::new();
        for (var_name, position) in &named_positions {
            let v = row_data.get(*position);
            bindings.insert(var_name.clone(), convert_variable_value(v, &context, &tx.type_manager));
        }

        rows.push(Row { bindings });
    }

    Ok(QueryResultIterator::new(rows, var_names))
}

fn execute_write_query(tx: InnerTransactionWrite, query: &str) -> Result<usize, Error> {
    let parsed = typeql::parse_query(query)?;
    let structure = parsed.into_structure();

    let pipeline_query = match structure {
        typeql::query::QueryStructure::Pipeline(p) => p,
        typeql::query::QueryStructure::Schema(_) => {
            return Err(Error::Query(
                "Schema queries cannot be executed in a write transaction. Use transaction_schema().".to_string(),
            ));
        }
    };

    let snapshot = tx.snapshot.into_inner();
    let pipeline = tx
        .query_manager
        .prepare_write_pipeline(
            snapshot,
            &tx.type_manager,
            tx.thing_manager.clone(),
            &tx.function_manager,
            &pipeline_query,
            query,
        )
        .map_err(|(_, e)| Error::Query(format!("{:?}", e)))?;

    let (mut iterator, context) = pipeline
        .into_rows_iterator(ExecutionInterrupt::new_uninterruptible())
        .map_err(|(e, _)| Error::Query(format!("{:?}", e)))?;

    let mut count = 0;
    while let Some(result) = iterator.next() {
        result.map_err(|e| Error::Query(format!("{:?}", e)))?;
        count += 1;
    }

    let snapshot = Arc::try_unwrap(context.snapshot)
        .map_err(|_| Error::Transaction("Snapshot still in use".to_string()))?;
    let mut commit_profile = CommitProfile::DISABLED;
    snapshot.commit(&mut commit_profile)
        .map_err(|e| Error::Commit(format!("{:?}", e)))?;

    Ok(count)
}

fn execute_schema_query(tx: &mut InnerTransactionSchema, query: &str) -> Result<(), Error> {
    let parsed = typeql::parse_query(query)?;
    let structure = parsed.into_structure();

    let schema_query = match structure {
        typeql::query::QueryStructure::Schema(s) => s,
        typeql::query::QueryStructure::Pipeline(_) => {
            return Err(Error::Query(
                "Pipeline queries cannot be executed in a schema transaction. Use transaction_write().".to_string(),
            ));
        }
    };

    let snapshot = tx.snapshot.as_mut().ok_or_else(|| Error::Transaction("Snapshot not available".to_string()))?;

    tx.query_manager
        .execute_schema(snapshot, &tx.type_manager, &tx.thing_manager, &tx.function_manager, schema_query, query)
        .map_err(|e| Error::Query(format!("{:?}", e)))?;

    Ok(())
}

// ============================================================================
// Value Conversion
// ============================================================================

fn extract_variable_positions(
    positions: Option<&std::collections::HashMap<String, compiler::VariablePosition>>,
) -> Vec<(String, compiler::VariablePosition)> {
    match positions {
        Some(pos_map) => {
            // Sort by position value for consistent ordering
            let mut vars: Vec<_> = pos_map.iter().map(|(name, pos)| (name.clone(), *pos)).collect();
            vars.sort_by_key(|(_, pos)| pos.as_usize());
            vars
        }
        None => vec![],
    }
}

fn convert_variable_value(
    value: &VariableValue<'_>,
    context: &executor::pipeline::stage::ExecutionContext<storage::snapshot::ReadSnapshot<NoopDurabilityClient>>,
    type_manager: &concept::type_::type_manager::TypeManager,
) -> Value {
    match value {
        VariableValue::None => Value::None,

        VariableValue::Type(ty) => {
            let label = ty
                .get_label(context.snapshot.as_ref(), type_manager)
                .ok()
                .map(|l| l.name().to_string())
                .unwrap_or_else(|| "unknown".to_string());

            let category = match ty {
                Type::Entity(_) => "entity",
                Type::Relation(_) => "relation",
                Type::Attribute(_) => "attribute",
                Type::RoleType(_) => "role",
            };

            Value::Type { category: category.to_string(), label }
        }

        VariableValue::Thing(thing) => convert_thing(thing, context, type_manager),

        VariableValue::Value(val) => Value::Computed(convert_encoding_value(val)),

        VariableValue::ThingList(items) => {
            Value::ThingList(items.iter().map(|t| convert_thing(t, context, type_manager)).collect())
        }

        VariableValue::ValueList(items) => Value::ValueList(items.iter().map(convert_encoding_value).collect()),
    }
}

fn convert_thing(
    thing: &Thing,
    context: &executor::pipeline::stage::ExecutionContext<storage::snapshot::ReadSnapshot<NoopDurabilityClient>>,
    type_manager: &concept::type_::type_manager::TypeManager,
) -> Value {
    let type_ = thing.type_();
    let label = type_
        .get_label(context.snapshot.as_ref(), type_manager)
        .ok()
        .map(|l| l.name().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    match thing {
        Thing::Entity(entity) => {
            Value::Entity { type_name: label, iid: format!("{:x}", entity.vertex().object_id().as_u64()) }
        }
        Thing::Relation(relation) => {
            Value::Relation { type_name: label, iid: format!("{:x}", relation.vertex().object_id().as_u64()) }
        }
        Thing::Attribute(attr) => {
            let value = attr
                .get_value(context.snapshot.as_ref(), context.thing_manager.as_ref(), StorageCounters::DISABLED)
                .ok()
                .map(|v| convert_encoding_value(&v))
                .unwrap_or(AttributeValue::String("<error>".to_string()));

            Value::Attribute { type_name: label, value }
        }
    }
}

fn convert_encoding_value(value: &EncodingValue<'_>) -> AttributeValue {
    match value {
        EncodingValue::Boolean(b) => AttributeValue::Boolean(*b),
        EncodingValue::Integer(i) => AttributeValue::Integer(*i),
        EncodingValue::Double(d) => AttributeValue::Double(*d),
        EncodingValue::Decimal(d) => AttributeValue::Decimal(format!("{}", d)),
        EncodingValue::Date(d) => AttributeValue::Date(d.to_string()),
        EncodingValue::DateTime(dt) => AttributeValue::DateTime(dt.to_string()),
        EncodingValue::DateTimeTZ(dt) => AttributeValue::DateTimeTZ(dt.to_string()),
        EncodingValue::Duration(d) => AttributeValue::Duration(format!("{:?}", d)),
        EncodingValue::String(s) => AttributeValue::String(s.to_string()),
        EncodingValue::Struct(s) => AttributeValue::Struct(format!("{:?}", s)),
    }
}
