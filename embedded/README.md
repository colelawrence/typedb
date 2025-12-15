# TypeDB Embedded

An embeddable TypeDB database for Rust applications, including WebAssembly targets.

## Features

- **Pure Rust**: No C/C++ dependencies, works on any target including WASM
- **In-Memory**: All data stored in memory with optional snapshot persistence
- **Full TypeQL**: Complete TypeQL support for schema and queries
- **Embeddable**: Use as a library in your Rust application
- **Snapshot Export/Import**: Save and restore database state as binary snapshots

## Quick Start

```rust
use typedb_embedded::{Database, Options, Error};

fn main() -> Result<(), Error> {
    // Create an in-memory database
    let db = Database::new("mydb")?;

    // Define schema
    {
        let mut tx = db.transaction_schema(Options::default())?;
        tx.execute("define entity person owns name; attribute name value string;")?;
        tx.commit()?;
    }

    // Insert data (auto-commits on success)
    {
        let tx = db.transaction_write(Options::default())?;
        tx.execute("insert $p isa person, has name \"Alice\";")?;
    }

    // Query data
    {
        let tx = db.transaction_read(Options::default())?;
        for row in tx.query("match $p isa person, has name $n;")? {
            println!("{:?}", row?);
        }
    }

    Ok(())
}
```

## API Overview

### Database

- `Database::new(name)` - Create a new in-memory database

### Transactions

| Type | Purpose | Commits |
|------|---------|---------|
| `transaction_read()` | Read queries (`match`, `fetch`) | N/A (read-only) |
| `transaction_write()` | Data mutations (`insert`, `delete`) | Auto on `execute()` |
| `transaction_schema()` | Schema changes (`define`, etc.) | Manual via `commit()` |

### Results

Query results are returned as an iterator of `Row` objects:

```rust
for row in tx.query("match $p isa person, has name $n;")? {
    let row = row?;
    if let Some(Value::Attribute { value, .. }) = row.get("n") {
        println!("Name: {:?}", value);
    }
}
```

## WASM Usage

Add to your `Cargo.toml`:

```toml
[dependencies]
typedb-embedded = { version = "0.1", default-features = false, features = ["memory"] }
```

Compile for WASM:

```bash
cargo build --target wasm32-unknown-unknown
```

## Snapshot Persistence

Export and import database state as binary snapshots:

```rust
use typedb_embedded::Database;

fn main() -> Result<(), Error> {
    let db = Database::new("mydb")?;

    // ... define schema and insert data ...

    // Export database to binary snapshot
    let snapshot: Vec<u8> = db.export_snapshot()?;

    // Save snapshot to file, send over network, etc.
    std::fs::write("backup.snapshot", &snapshot)?;

    // Later: restore from snapshot
    let mut db2 = Database::new("restored")?;
    let snapshot = std::fs::read("backup.snapshot")?;
    db2.import_snapshot(&snapshot)?;

    // db2 now contains all the data from db
    Ok(())
}
```

**Note**: Ensure no transactions are active when calling `import_snapshot()`.

## Limitations

- **In-memory storage**: Data is stored in memory; use snapshots for persistence
- **Single-query write transactions**: Each write transaction executes one query and auto-commits
- **Snapshot for persistence**: Use `export_snapshot()`/`import_snapshot()` to save/restore data

## License

Mozilla Public License 2.0
