/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Database creation and management.

use std::sync::Arc;

use options::TransactionOptions;
use storage::durability_client::NoopDurabilityClient;

use crate::{
    error::Error,
    transaction::{TransactionRead, TransactionSchema, TransactionWrite},
};

/// An in-memory TypeDB database.
///
/// Create databases using [`Database::new`]. All data is stored in memory
/// and will be lost when the database is dropped.
///
/// # Example
///
/// ```rust,no_run
/// use typedb_embedded::{Database, Options};
///
/// let db = Database::new("mydb").unwrap();
/// let mut tx = db.transaction_schema(Options::default()).unwrap();
/// tx.execute("define entity person;")?;
/// tx.commit()?;
/// # Ok::<(), typedb_embedded::Error>(())
/// ```
pub struct Database {
    inner: Arc<database::Database<NoopDurabilityClient>>,
}

impl Database {
    /// Create a new in-memory database with the given name.
    ///
    /// The name is used for identification purposes only; no files are created.
    ///
    /// # Errors
    ///
    /// Returns an error if database initialization fails.
    pub fn new(name: &str) -> Result<Self, Error> {
        let inner = database::Database::create_in_memory(name)?;
        Ok(Self { inner: Arc::new(inner) })
    }

    /// Get the database name.
    pub fn name(&self) -> &str {
        self.inner.name()
    }

    /// Open a read transaction.
    ///
    /// Read transactions can execute `match` and `fetch` queries but cannot
    /// modify data or schema.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use typedb_embedded::{Database, Options};
    /// # let db = Database::new("mydb").unwrap();
    /// let tx = db.transaction_read(Options::default())?;
    /// let results = tx.query("match $x isa person;")?;
    /// # Ok::<(), typedb_embedded::Error>(())
    /// ```
    pub fn transaction_read(&self, options: TransactionOptions) -> Result<TransactionRead, Error> {
        TransactionRead::open(self.inner.clone(), options)
    }

    /// Open a write transaction.
    ///
    /// Write transactions can execute `insert`, `delete`, and `update` queries.
    /// Changes are automatically committed when [`TransactionWrite::execute`] succeeds.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use typedb_embedded::{Database, Options};
    /// # let db = Database::new("mydb").unwrap();
    /// let tx = db.transaction_write(Options::default())?;
    /// let count = tx.execute("insert $p isa person;")?;  // auto-commits on success
    /// # Ok::<(), typedb_embedded::Error>(())
    /// ```
    pub fn transaction_write(&self, options: TransactionOptions) -> Result<TransactionWrite, Error> {
        TransactionWrite::open(self.inner.clone(), options)
    }

    /// Open a schema transaction.
    ///
    /// Schema transactions can execute `define`, `undefine`, and `redefine` queries.
    /// Changes are only persisted when [`TransactionSchema::commit`] is called.
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
    pub fn transaction_schema(&self, options: TransactionOptions) -> Result<TransactionSchema, Error> {
        TransactionSchema::open(self.inner.clone(), options)
    }

    /// Export the database as a binary snapshot.
    ///
    /// The snapshot contains all data stored in the database and can be
    /// saved to persistent storage (e.g., IndexedDB in browsers) and later
    /// imported with [`Database::import_snapshot`].
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use typedb_embedded::Database;
    /// let db = Database::new("mydb")?;
    /// // ... insert data ...
    /// let snapshot = db.export_snapshot()?;
    /// // Save `snapshot` to persistent storage
    /// # Ok::<(), typedb_embedded::Error>(())
    /// ```
    ///
    /// # Warning
    ///
    /// For consistency, ensure no write or schema transactions are active
    /// when calling this method.
    pub fn export_snapshot(&self) -> Result<Vec<u8>, Error> {
        self.inner.export_snapshot().map_err(Error::from)
    }

    /// Import a binary snapshot, replacing all data in the database.
    ///
    /// The snapshot should have been created with [`Database::export_snapshot`].
    /// After importing, the database will contain the same data as when
    /// the snapshot was exported.
    ///
    /// # Example
    ///
    /// ```rust,no_run
    /// # use typedb_embedded::Database;
    /// let mut db = Database::new("mydb")?;
    /// // Load `snapshot` from persistent storage
    /// # let snapshot = vec![];
    /// db.import_snapshot(&snapshot)?;
    /// // Database now contains the restored data
    /// # Ok::<(), typedb_embedded::Error>(())
    /// ```
    ///
    /// # Warning
    ///
    /// This replaces all data in the database. Ensure no transactions are
    /// active when calling this method. If there are active transactions,
    /// this method will panic.
    pub fn import_snapshot(&mut self, bytes: &[u8]) -> Result<(), Error> {
        let inner = Arc::get_mut(&mut self.inner)
            .expect("Cannot import snapshot while other references exist (e.g., active transactions)");
        inner.import_snapshot(bytes).map_err(Error::from)
    }
}

impl std::fmt::Debug for Database {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Database").field("name", &self.name()).finish()
    }
}
