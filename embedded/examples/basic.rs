/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Basic example of using typedb-embedded.
//!
//! Run with: `cargo run -p typedb-embedded --example basic`

use typedb_embedded::{Database, Error, Options, Value};

fn main() -> Result<(), Error> {
    println!("Creating in-memory TypeDB database...");
    let db = Database::new("example_db")?;
    println!("Database '{}' created.\n", db.name());

    // Define schema
    println!("Defining schema...");
    {
        let mut tx = db.transaction_schema(Options::default())?;
        tx.execute(
            r#"
            define
            entity person owns name, owns age;
            attribute name value string;
            attribute age value integer;
            "#,
        )?;
        tx.commit()?;
    }
    println!("Schema defined.\n");

    // Insert some data
    println!("Inserting data...");
    let names = [("Alice", 30), ("Bob", 25), ("Charlie", 35)];
    for (name, age) in names {
        let tx = db.transaction_write(Options::default())?;
        tx.execute(&format!(
            r#"insert $p isa person, has name "{}", has age {};"#,
            name, age
        ))?;
        println!("  Inserted: {} (age {})", name, age);
    }
    println!();

    // Query the data
    println!("Querying all people...");
    {
        let tx = db.transaction_read(Options::default())?;
        let results = tx.query("match $p isa person, has name $n, has age $a;")?;

        for row in results {
            let row = row?;
            let name = row.get("n");
            let age = row.get("a");

            match (name, age) {
                (
                    Some(Value::Attribute { value: name_val, .. }),
                    Some(Value::Attribute { value: age_val, .. }),
                ) => {
                    println!(
                        "  Found: {:?} (age {:?})",
                        name_val.as_string(),
                        age_val.as_integer()
                    );
                }
                _ => println!("  Found row: {:?}", row),
            }
        }
    }

    println!("\nDone!");
    Ok(())
}
