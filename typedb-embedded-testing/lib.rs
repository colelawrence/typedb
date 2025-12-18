/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! TypeDB Embedded Testing Utilities
//!
//! This crate provides test utilities and common test scenarios for
//! `typedb-embedded`. Use it to write tests for applications that
//! use the embedded TypeDB library.
//!
//! # Usage
//!
//! ```rust
//! use typedb_embedded_testing::TestDatabase;
//!
//! let db = TestDatabase::new("test_db");
//! db.define_schema("define entity person;").unwrap();
//! db.write("insert $p isa person;").unwrap();
//! let count = db.query_count("match $p isa person;").unwrap();
//! assert_eq!(count, 1);
//! ```
//!
//! # Schema Fixtures
//!
//! Common schemas are available via the `fixtures` module:
//!
//! ```rust
//! use typedb_embedded_testing::{TestDatabase, fixtures};
//!
//! let db = TestDatabase::new("test_db");
//! db.define_schema(fixtures::PERSON_WITH_KEY).unwrap();
//! ```
//!
//! # Test Outcome Classification
//!
//! For cross-environment testing (native vs WASM), use `TestOutcome` and
//! `TestReport` to document behavior differences:
//!
//! ```rust
//! use typedb_embedded_testing::{TestOutcome, TestReport, TestCategory};
//!
//! let outcome = TestOutcome::BehaviorDiffers {
//!     expected: "Error on insert",
//!     actual: "Insert succeeded".to_string(),
//! };
//! let report = TestReport::new("my_test", TestCategory::Constraints, outcome);
//! eprintln!("{}", report.to_json());
//! ```
//!
//! # Common Test Scenarios
//!
//! This crate also re-exports `typedb_embedded::common_tests` which provides
//! reusable test scenarios that can be run from both native Rust tests and
//! WASM environments.

#![deny(unused_must_use)]

use std::panic::{catch_unwind, AssertUnwindSafe};

pub use typedb_embedded::{
    common_tests, AttributeValue, Database, Error, Options, QueryResultIterator, Row,
    TransactionRead, TransactionSchema, TransactionWrite, Value,
};

/// Test context holding a database instance with convenience methods.
pub struct TestDatabase {
    db: Database,
}

impl TestDatabase {
    /// Create a new in-memory test database.
    pub fn new(name: &str) -> Self {
        let db = Database::new(name).expect("Failed to create in-memory database");
        Self { db }
    }

    /// Get the underlying database.
    pub fn database(&self) -> &Database {
        &self.db
    }

    /// Define schema using a schema query string.
    /// Opens a schema transaction, executes, and commits.
    pub fn define_schema(&self, schema: &str) -> Result<(), Error> {
        let mut tx = self.db.transaction_schema(Options::default())?;
        tx.execute(schema)?;
        tx.commit()
    }

    /// Execute a write query (insert/delete/update).
    /// Opens a write transaction, executes (which auto-commits), and returns row count.
    pub fn write(&self, query: &str) -> Result<usize, Error> {
        let tx = self.db.transaction_write(Options::default())?;
        tx.execute(query)
    }

    /// Execute a read query and return the row count.
    pub fn query_count(&self, query: &str) -> Result<usize, Error> {
        let tx = self.db.transaction_read(Options::default())?;
        let results = tx.query(query)?;
        Ok(results.len())
    }

    /// Execute a read query and collect all results.
    pub fn query_all(&self, query: &str) -> Result<Vec<Row>, Error> {
        let tx = self.db.transaction_read(Options::default())?;
        let results = tx.query(query)?;
        results.collect()
    }

    /// Open a read transaction for more complex queries.
    pub fn open_read(&self) -> Result<TransactionRead, Error> {
        self.db.transaction_read(Options::default())
    }

    /// Open a write transaction.
    pub fn open_write(&self) -> Result<TransactionWrite, Error> {
        self.db.transaction_write(Options::default())
    }

    /// Open a schema transaction.
    pub fn open_schema(&self) -> Result<TransactionSchema, Error> {
        self.db.transaction_schema(Options::default())
    }
}

/// Assertion helper macro for checking query results.
#[macro_export]
macro_rules! assert_query_count {
    ($db:expr, $query:expr, $expected:expr) => {
        let count = $db
            .query_count($query)
            .expect(&format!("Query failed: {}", $query));
        assert_eq!(
            count, $expected,
            "Query '{}' returned {} rows, expected {}",
            $query, count, $expected
        );
    };
}

/// Assertion helper for successful schema definition.
#[macro_export]
macro_rules! assert_schema_ok {
    ($db:expr, $schema:expr) => {
        $db.define_schema($schema)
            .expect(&format!("Schema definition failed: {}", $schema));
    };
}

/// Assertion helper for successful write execution.
#[macro_export]
macro_rules! assert_write_ok {
    ($db:expr, $query:expr) => {
        $db.write($query)
            .expect(&format!("Write query failed: {}", $query));
    };
}

/// Assertion helper for write execution returning specific row count.
#[macro_export]
macro_rules! assert_write_count {
    ($db:expr, $query:expr, $expected:expr) => {
        let count = $db
            .write($query)
            .expect(&format!("Write query failed: {}", $query));
        assert_eq!(
            count, $expected,
            "Write '{}' produced {} rows, expected {}",
            $query, count, $expected
        );
    };
}

// ============================================================================
// Schema Fixtures
// ============================================================================

/// Common schema fixtures for testing, mirroring the TypeQL test harness.
///
/// These correspond to the `schemas` object in
/// `sdk/embedded/src/typeql-validation-tests/harness.ts`.
pub mod fixtures {
    /// Simple person entity with name attribute.
    pub const SIMPLE_PERSON: &str = r#"
        define
        attribute name value string;
        entity person owns name;
    "#;

    /// Person with @key constraint on email.
    ///
    /// TypeQL Reference: `harness.ts::schemas.personWithKey`
    pub const PERSON_WITH_KEY: &str = r#"
        define
        attribute name value string;
        attribute email value string;
        attribute age value integer;
        entity person owns name, owns email @key, owns age;
    "#;

    /// Employment relation between person and company.
    ///
    /// TypeQL Reference: `harness.ts::schemas.employment`
    pub const EMPLOYMENT: &str = r#"
        define
        attribute name value string;
        attribute email value string;
        entity person owns name, owns email;
        entity company owns name;
        relation employment relates employee, relates employer;
        person plays employment:employee;
        company plays employment:employer;
    "#;

    /// Friendship relation (symmetric, requires 2 friends).
    ///
    /// TypeQL Reference: `harness.ts::schemas.friendship`
    pub const FRIENDSHIP: &str = r#"
        define
        attribute name value string;
        attribute email value string;
        entity person owns name, owns email @key;
        relation friendship relates friend;
        person plays friendship:friend;
    "#;

    /// Social network with following relation.
    ///
    /// TypeQL Reference: `harness.ts::schemas.socialNetwork`
    pub const SOCIAL_NETWORK: &str = r#"
        define
        attribute username value string;
        attribute email value string;
        entity user owns username @key, owns email @card(0..) @unique;
        relation following relates follower @card(1), relates target @card(1);
        user plays following:follower;
        user plays following:target;
    "#;

    /// All value types for comprehensive testing.
    ///
    /// TypeQL Reference: `harness.ts::schemas.allValueTypes`
    pub const ALL_VALUE_TYPES: &str = r#"
        define
        attribute string-val value string;
        attribute integer-val value integer;
        attribute double-val value double;
        attribute boolean-val value boolean;
        attribute date-val value date;
        attribute datetime-val value datetime;
        entity test-entity
            owns string-val,
            owns integer-val,
            owns double-val,
            owns boolean-val,
            owns date-val,
            owns datetime-val;
    "#;

    /// Abstract types for inheritance testing.
    ///
    /// TypeQL Reference: `harness.ts::schemas.abstractTypes`
    pub const ABSTRACT_TYPES: &str = r#"
        define
        attribute name value string;
        attribute email value string;
        entity account @abstract owns name, owns email @key;
        entity user sub account;
        entity admin sub user;
    "#;

    /// Schema with cardinality constraints for testing @card enforcement.
    pub const CARDINALITY_CONSTRAINTS: &str = r#"
        define
        attribute name value string;
        attribute tag value string;
        attribute required-field value string;
        attribute single-val value string;
        entity item owns name, owns single-val @card(0..1);
        entity tagged-item owns name, owns tag @card(0..);
        entity required-item owns name, owns required-field @card(1..);
    "#;

    /// Schema with @unique constraint.
    pub const UNIQUE_CONSTRAINT: &str = r#"
        define
        attribute name value string;
        attribute username value string;
        entity user owns name, owns username @unique;
    "#;

    /// Schema with @values constraint (enumeration).
    pub const VALUES_CONSTRAINT: &str = r#"
        define
        attribute name value string;
        attribute status value string @values("active", "inactive", "pending");
        entity account owns name, owns status;
    "#;

    /// Schema with @range constraint.
    pub const RANGE_CONSTRAINT: &str = r#"
        define
        attribute name value string;
        attribute age value integer @range(0..150);
        entity person owns name, owns age;
    "#;

    /// Schema with @regex constraint.
    pub const REGEX_CONSTRAINT: &str = r#"
        define
        attribute name value string;
        attribute code value string @regex("^[A-Z]{3}-[0-9]{4}$");
        entity item owns name, owns code;
    "#;
}

// ============================================================================
// Test Outcome Classification
// ============================================================================

/// Classification of test outcomes for cross-environment analysis.
///
/// Used to document behavior differences between native Rust, WASM, and
/// wasm-bindgen environments.
#[derive(Debug, Clone, PartialEq)]
pub enum TestOutcome {
    /// Feature works exactly as expected per TypeQL spec.
    Works,

    /// Feature works but behavior differs from TypeQL spec.
    BehaviorDiffers {
        expected: &'static str,
        actual: String,
    },

    /// Feature is not implemented (returns error indicating not supported).
    NotImplemented { error: String },

    /// Feature causes a panic (critical for WASM - crashes the runtime).
    Panics { message: String },

    /// Validation is deferred (e.g., constraint checked at commit, not insert).
    ValidationDeferred { when_validated: &'static str },

    /// Feature partially works.
    Partial {
        working: &'static str,
        not_working: &'static str,
    },

    /// Test was skipped (e.g., prerequisite not met).
    Skipped { reason: &'static str },
}

/// Environment detection for cross-platform testing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TestEnvironment {
    NativeRust,
    Wasm32,
}

impl TestEnvironment {
    /// Detect the current execution environment.
    pub fn detect() -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            TestEnvironment::Wasm32
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            TestEnvironment::NativeRust
        }
    }

    /// Returns a short string identifier for the environment.
    pub fn as_str(&self) -> &'static str {
        match self {
            TestEnvironment::NativeRust => "native",
            TestEnvironment::Wasm32 => "wasm32",
        }
    }
}

/// Category of test for organization and filtering.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TestCategory {
    Constraints,
    SchemaModification,
    Rules,
    Functions,
    Fetch,
    Explanation,
}

impl TestCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            TestCategory::Constraints => "constraints",
            TestCategory::SchemaModification => "schema_modification",
            TestCategory::Rules => "rules",
            TestCategory::Functions => "functions",
            TestCategory::Fetch => "fetch",
            TestCategory::Explanation => "explanation",
        }
    }
}

/// Structured test result for reporting and CI integration.
#[derive(Debug)]
pub struct TestReport {
    /// Name of the test function.
    pub test_name: &'static str,
    /// Link to corresponding TypeQL validation test (e.g., "errors/constraint-violations.test.ts::test name").
    pub typeql_reference: Option<&'static str>,
    /// Link to TypeQL spec section (e.g., "TYPEQL_3_SYNTAX_GUIDE.md Section 2.5").
    pub spec_reference: Option<&'static str>,
    /// Category for filtering.
    pub category: TestCategory,
    /// What happened when the test ran.
    pub outcome: TestOutcome,
    /// Where the test ran.
    pub environment: TestEnvironment,
}

impl TestReport {
    /// Create a new test report.
    pub fn new(test_name: &'static str, category: TestCategory, outcome: TestOutcome) -> Self {
        Self {
            test_name,
            typeql_reference: None,
            spec_reference: None,
            category,
            outcome,
            environment: TestEnvironment::detect(),
        }
    }

    /// Add a reference to the corresponding TypeQL validation test.
    pub fn with_typeql_ref(mut self, reference: &'static str) -> Self {
        self.typeql_reference = Some(reference);
        self
    }

    /// Add a reference to the TypeQL specification section.
    pub fn with_spec_ref(mut self, reference: &'static str) -> Self {
        self.spec_reference = Some(reference);
        self
    }

    /// Output as JSON for CI integration.
    ///
    /// Format: `{"test":"name","category":"cat","outcome":"...","env":"native"}`
    pub fn to_json(&self) -> String {
        let outcome_str = match &self.outcome {
            TestOutcome::Works => "works".to_string(),
            TestOutcome::BehaviorDiffers { expected, actual } => {
                format!("differs:{}|{}", expected, actual)
            }
            TestOutcome::NotImplemented { error } => format!("not_implemented:{}", error),
            TestOutcome::Panics { message } => format!("panics:{}", message),
            TestOutcome::ValidationDeferred { when_validated } => {
                format!("deferred:{}", when_validated)
            }
            TestOutcome::Partial { working, not_working } => {
                format!("partial:{}|{}", working, not_working)
            }
            TestOutcome::Skipped { reason } => format!("skipped:{}", reason),
        };

        format!(
            r#"{{"test":"{}","category":"{}","outcome":"{}","env":"{}","typeql_ref":{},"spec_ref":{}}}"#,
            self.test_name,
            self.category.as_str(),
            outcome_str,
            self.environment.as_str(),
            self.typeql_reference
                .map(|r| format!("\"{}\"", r))
                .unwrap_or_else(|| "null".to_string()),
            self.spec_reference
                .map(|r| format!("\"{}\"", r))
                .unwrap_or_else(|| "null".to_string()),
        )
    }

    /// Print the report to stderr (visible in test output).
    pub fn print(&self) {
        eprintln!("TEST_DISCOVERY: {}", self.to_json());
    }

    /// Write to the discovery output file if the feature is enabled.
    #[cfg(feature = "discovery-output")]
    pub fn write_to_file(&self) {
        use std::fs::OpenOptions;
        use std::io::Write;

        if let Ok(mut f) = OpenOptions::new()
            .create(true)
            .append(true)
            .open("target/test-discovery.jsonl")
        {
            let _ = writeln!(f, "{}", self.to_json());
        }
    }

    #[cfg(not(feature = "discovery-output"))]
    pub fn write_to_file(&self) {
        // No-op when feature not enabled
    }

    /// Print and optionally write to file.
    pub fn report(&self) {
        self.print();
        self.write_to_file();
    }
}

// ============================================================================
// Error Classification
// ============================================================================

/// Classification of errors for better analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCategory {
    /// TypeQL syntax error.
    ParseError,
    /// Schema validation error.
    ValidationError,
    /// @key, @unique, @card violation.
    ConstraintViolation,
    /// Wrong type in query.
    TypeMismatch,
    /// Feature not available.
    NotImplemented,
    /// Unexpected internal error.
    InternalError,
    /// Unclassified error.
    Unknown,
}

/// Classify an error based on its message content.
pub fn classify_error(error: &Error) -> ErrorCategory {
    let msg = format!("{:?}", error).to_lowercase();

    if msg.contains("parse") || msg.contains("syntax") || msg.contains("pex") {
        ErrorCategory::ParseError
    } else if msg.contains("not implemented") || msg.contains("unsupported") {
        ErrorCategory::NotImplemented
    } else if msg.contains("constraint") || msg.contains("violation") || msg.contains("cnt") {
        ErrorCategory::ConstraintViolation
    } else if msg.contains("type") && (msg.contains("mismatch") || msg.contains("expected")) {
        ErrorCategory::TypeMismatch
    } else if msg.contains("validation") || msg.contains("dvl") {
        ErrorCategory::ValidationError
    } else if msg.contains("internal") {
        ErrorCategory::InternalError
    } else {
        ErrorCategory::Unknown
    }
}

// ============================================================================
// Value Assertion Helpers
// ============================================================================

/// Extension trait for convenient value assertions on `Row`.
pub trait RowAssertions {
    /// Get a binding or panic with a descriptive message.
    fn expect_binding(&self, name: &str) -> &Value;

    /// Get an integer value from a binding.
    fn expect_integer(&self, name: &str) -> i64;

    /// Get a string value from a binding.
    fn expect_string(&self, name: &str) -> String;

    /// Get a double value from a binding.
    fn expect_double(&self, name: &str) -> f64;

    /// Get a boolean value from a binding.
    fn expect_boolean(&self, name: &str) -> bool;
}

impl RowAssertions for Row {
    fn expect_binding(&self, name: &str) -> &Value {
        self.get(name)
            .unwrap_or_else(|| panic!("Row missing expected binding '{}'", name))
    }

    fn expect_integer(&self, name: &str) -> i64 {
        let value = self.expect_binding(name);
        match value {
            Value::Computed(AttributeValue::Integer(n)) => *n,
            Value::Attribute { value: AttributeValue::Integer(n), .. } => *n,
            other => panic!(
                "Binding '{}': expected integer, got {:?}",
                name, other
            ),
        }
    }

    fn expect_string(&self, name: &str) -> String {
        let value = self.expect_binding(name);
        match value {
            Value::Computed(AttributeValue::String(s)) => s.clone(),
            Value::Attribute { value: AttributeValue::String(s), .. } => s.clone(),
            other => panic!(
                "Binding '{}': expected string, got {:?}",
                name, other
            ),
        }
    }

    fn expect_double(&self, name: &str) -> f64 {
        let value = self.expect_binding(name);
        match value {
            Value::Computed(AttributeValue::Double(d)) => *d,
            Value::Attribute { value: AttributeValue::Double(d), .. } => *d,
            other => panic!(
                "Binding '{}': expected double, got {:?}",
                name, other
            ),
        }
    }

    fn expect_boolean(&self, name: &str) -> bool {
        let value = self.expect_binding(name);
        match value {
            Value::Computed(AttributeValue::Boolean(b)) => *b,
            Value::Attribute { value: AttributeValue::Boolean(b), .. } => *b,
            other => panic!(
                "Binding '{}': expected boolean, got {:?}",
                name, other
            ),
        }
    }
}

// ============================================================================
// Panic Safety for WASM
// ============================================================================

/// Run a closure with panic catching (critical for WASM safety).
///
/// In WASM, an uncaught panic crashes the entire runtime. This function
/// catches panics and returns them as `TestOutcome::Panics`.
///
/// # Example
///
/// ```rust
/// use typedb_embedded_testing::{run_with_panic_catch, TestOutcome};
///
/// let result = run_with_panic_catch("my_test", || {
///     // potentially panicking code
///     42
/// });
///
/// match result {
///     Ok(value) => println!("Got: {}", value),
///     Err(outcome) => println!("Panicked: {:?}", outcome),
/// }
/// ```
pub fn run_with_panic_catch<F, T>(test_name: &str, f: F) -> Result<T, TestOutcome>
where
    F: FnOnce() -> T,
{
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(result) => Ok(result),
        Err(panic_info) => {
            let message = if let Some(s) = panic_info.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = panic_info.downcast_ref::<String>() {
                s.clone()
            } else {
                "Unknown panic".to_string()
            };

            eprintln!("⚠️  PANIC in {}: {}", test_name, message);
            Err(TestOutcome::Panics { message })
        }
    }
}

/// Macro for standardized discovery tests that document behavior.
///
/// This macro creates a test that:
/// 1. Runs the test body
/// 2. Reports the outcome via `TestReport`
/// 3. Optionally writes to the discovery output file
///
/// # Example
///
/// ```rust,ignore
/// discover_behavior!(
///     constraint_key_missing,
///     TestCategory::Constraints,
///     "errors/constraint-violations.test.ts::missing key attribute throws error",
///     {
///         let db = TestDatabase::new("test");
///         db.define_schema(fixtures::PERSON_WITH_KEY).unwrap();
///         match db.write("insert $p isa person;") {
///             Ok(_) => TestOutcome::BehaviorDiffers {
///                 expected: "Error on insert",
///                 actual: "Insert succeeded".to_string(),
///             },
///             Err(e) => TestOutcome::Works,
///         }
///     }
/// );
/// ```
#[macro_export]
macro_rules! discover_behavior {
    ($test_name:ident, $category:expr, $typeql_ref:expr, $body:expr) => {
        #[test]
        fn $test_name() {
            let outcome = $body;
            let report = $crate::TestReport::new(stringify!($test_name), $category, outcome)
                .with_typeql_ref($typeql_ref);
            report.report();
        }
    };
}
