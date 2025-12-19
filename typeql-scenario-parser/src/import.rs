/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Import resolution for scenario files.
//!
//! This module provides functionality to resolve `import` stages in scenarios,
//! loading and flattening imported setup stages from other files.
//!
//! ## Import Semantics
//!
//! When a scenario imports another file:
//! 1. Only **setup stages** (schema, data) are extracted from the imported file
//! 2. Query, expect, and other non-setup stages are filtered out
//! 3. Imports are resolved depth-first (nested imports processed first)
//! 4. Circular imports are detected and rejected
//!
//! ## Example
//!
//! ```ignore
//! use typeql_scenario_parser::import::{resolve_imports, FsFileLoader};
//!
//! let scenario = parse_file("main.md")?;
//! let loader = FsFileLoader;
//! let resolved = resolve_imports(scenario, &loader)?;
//! ```

use crate::models::{ParseError, Scenario, Stage, StageKind};
use crate::parser::ScenarioParser;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Stage types that are considered "setup" and will be imported.
/// Only these stage types are extracted from imported files.
pub const SETUP_STAGE_TYPES: &[&str] = &["schema", "data"];

/// Trait for loading file contents.
///
/// This abstraction allows for different file loading strategies,
/// such as filesystem access, in-memory files for testing, or remote fetching.
pub trait FileLoader {
    /// Load the contents of a file at the given path.
    fn load(&self, path: &Path) -> Result<String, ParseError>;
}

/// File system loader using `std::fs::read_to_string`.
pub struct FsFileLoader;

impl FileLoader for FsFileLoader {
    fn load(&self, path: &Path) -> Result<String, ParseError> {
        std::fs::read_to_string(path).map_err(|e| ParseError::Io(format!("{}: {}", path.display(), e)))
    }
}

/// In-memory file loader for testing.
///
/// Maps file paths to their contents.
pub struct MemoryFileLoader {
    files: std::collections::HashMap<PathBuf, String>,
}

impl MemoryFileLoader {
    /// Create a new memory loader with no files.
    pub fn new() -> Self {
        Self {
            files: std::collections::HashMap::new(),
        }
    }

    /// Add a file to the loader.
    pub fn add_file(&mut self, path: impl Into<PathBuf>, content: impl Into<String>) {
        self.files.insert(path.into(), content.into());
    }
}

impl Default for MemoryFileLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl FileLoader for MemoryFileLoader {
    fn load(&self, path: &Path) -> Result<String, ParseError> {
        self.files
            .get(path)
            .cloned()
            .ok_or_else(|| ParseError::ImportNotFound {
                path: path.display().to_string(),
            })
    }
}

/// Check if a stage kind is a setup stage (importable).
fn is_setup_stage(kind: &StageKind) -> bool {
    matches!(kind, StageKind::Schema(_) | StageKind::Data(_))
}

/// Resolve all imports in a scenario, returning a flattened scenario.
///
/// This function:
/// 1. Finds all `Import` stages in the scenario
/// 2. Loads and parses each imported file
/// 3. Recursively resolves imports in those files
/// 4. Extracts only setup stages (schema, data) from imports
/// 5. Prepends imported stages to the scenario's own stages
///
/// # Arguments
///
/// * `scenario` - The scenario with unresolved imports
/// * `loader` - File loader for reading imported files
///
/// # Returns
///
/// A new scenario with all imports resolved and flattened.
///
/// # Errors
///
/// Returns an error if:
/// - A circular import is detected
/// - An imported file cannot be loaded
/// - An imported file cannot be parsed
pub fn resolve_imports<L: FileLoader>(
    scenario: Scenario,
    loader: &L,
) -> Result<Scenario, ParseError> {
    let mut visited = HashSet::new();
    let base_path = scenario
        .source_path
        .as_ref()
        .map(|p| PathBuf::from(p))
        .unwrap_or_else(|| PathBuf::from("."));

    // Add the base file to visited set
    if let Some(canonical) = canonicalize_path(&base_path) {
        visited.insert(canonical);
    }

    resolve_imports_inner(scenario, loader, &mut visited, &base_path)
}

/// Internal recursive import resolution.
fn resolve_imports_inner<L: FileLoader>(
    scenario: Scenario,
    loader: &L,
    visited: &mut HashSet<PathBuf>,
    current_file: &Path,
) -> Result<Scenario, ParseError> {
    let base_dir = current_file
        .parent()
        .unwrap_or_else(|| Path::new("."));

    let mut resolved_stages: Vec<Stage> = Vec::new();

    for stage in scenario.stages {
        match &stage.kind {
            StageKind::Import(paths) => {
                // Process each import path
                for import_path in paths {
                    let full_path = resolve_path(base_dir, import_path);
                    let canonical = canonicalize_path(&full_path)
                        .unwrap_or_else(|| full_path.clone());

                    // Check for circular import
                    if visited.contains(&canonical) {
                        return Err(ParseError::CircularImport {
                            chain: format!(
                                "{} -> {}",
                                current_file.display(),
                                full_path.display()
                            ),
                        });
                    }

                    // Mark as visited
                    visited.insert(canonical.clone());

                    // Load and parse the imported file
                    let content = loader.load(&full_path)?;
                    let parser = ScenarioParser::new();
                    let imported = parser.parse(&content, Some(&full_path.to_string_lossy()))?;

                    // Recursively resolve imports in the imported file
                    let resolved_imported = resolve_imports_inner(
                        imported,
                        loader,
                        visited,
                        &full_path,
                    )?;

                    // Extract only setup stages
                    for imported_stage in resolved_imported.stages {
                        if is_setup_stage(&imported_stage.kind) {
                            resolved_stages.push(imported_stage);
                        }
                    }
                }
            }
            _ => {
                // Keep non-import stages as-is
                resolved_stages.push(stage);
            }
        }
    }

    Ok(Scenario {
        stages: resolved_stages,
        ..scenario
    })
}

/// Resolve a potentially relative path against a base directory.
fn resolve_path(base_dir: &Path, path: &str) -> PathBuf {
    let path = Path::new(path);
    if path.is_absolute() {
        normalize_path(path)
    } else {
        normalize_path(&base_dir.join(path))
    }
}

/// Normalize a path by resolving `.` and `..` components.
fn normalize_path(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                result.pop();
            }
            std::path::Component::CurDir => {}
            _ => {
                result.push(component);
            }
        }
    }
    result
}

/// Attempt to canonicalize a path for comparison.
/// Returns None if the path doesn't exist or can't be canonicalized.
fn canonicalize_path(path: &Path) -> Option<PathBuf> {
    Some(normalize_path(path))
}

/// Parse a scenario from content and resolve all imports.
///
/// This is a convenience function that combines parsing and import resolution.
pub fn parse_with_imports<L: FileLoader>(
    content: &str,
    loader: &L,
    source_path: Option<&str>,
) -> Result<Scenario, ParseError> {
    let parser = ScenarioParser::new();
    let scenario = parser.parse(content, source_path)?;
    resolve_imports(scenario, loader)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_import_block() {
        let content = r#"
```import
./base.md
./data.md
```

```typeql:query
match $x isa thing;
```
"#;
        let parser = ScenarioParser::new();
        let scenario = parser.parse(content, None).unwrap();

        assert_eq!(scenario.stages.len(), 2);
        if let StageKind::Import(paths) = &scenario.stages[0].kind {
            assert_eq!(paths, &vec!["./base.md", "./data.md"]);
        } else {
            panic!("Expected import stage");
        }
    }

    #[test]
    fn test_parse_import_with_comments() {
        let content = r#"
```import
# Base schema
./base.md

# Test data
./data.md
```
"#;
        let parser = ScenarioParser::new();
        let scenario = parser.parse(content, None).unwrap();

        if let StageKind::Import(paths) = &scenario.stages[0].kind {
            assert_eq!(paths, &vec!["./base.md", "./data.md"]);
        } else {
            panic!("Expected import stage");
        }
    }

    #[test]
    fn test_simple_import() {
        let mut loader = MemoryFileLoader::new();
        loader.add_file(
            "/test/base.md",
            r#"
```typeql:schema
define attribute name, value string;
```
"#,
        );

        let content = r#"
```import
./base.md
```

```typeql:query
match $x isa thing;
```
"#;

        let parser = ScenarioParser::new();
        let scenario = parser.parse(content, Some("/test/main.md")).unwrap();
        let resolved = resolve_imports(scenario, &loader).unwrap();

        // Should have schema from import + query from main
        assert_eq!(resolved.stages.len(), 2);
        assert!(matches!(resolved.stages[0].kind, StageKind::Schema(_)));
        assert!(matches!(resolved.stages[1].kind, StageKind::Query(_)));
    }

    #[test]
    fn test_nested_imports() {
        let mut loader = MemoryFileLoader::new();
        loader.add_file(
            "/test/base.md",
            r#"
```typeql:schema
define attribute id, value string;
```
"#,
        );
        loader.add_file(
            "/test/middle.md",
            r#"
```import
./base.md
```

```typeql:schema
define entity person, owns id;
```

```typeql:data
insert $p isa person, has id "1";
```
"#,
        );

        let content = r#"
```import
./middle.md
```

```typeql:query
match $p isa person;
```
"#;

        let parser = ScenarioParser::new();
        let scenario = parser.parse(content, Some("/test/main.md")).unwrap();
        let resolved = resolve_imports(scenario, &loader).unwrap();

        // Order: base schema -> middle schema -> middle data -> main query
        assert_eq!(resolved.stages.len(), 4);
        assert!(matches!(resolved.stages[0].kind, StageKind::Schema(_))); // base
        assert!(matches!(resolved.stages[1].kind, StageKind::Schema(_))); // middle
        assert!(matches!(resolved.stages[2].kind, StageKind::Data(_)));   // middle
        assert!(matches!(resolved.stages[3].kind, StageKind::Query(_)));  // main
    }

    #[test]
    fn test_filters_non_setup_stages() {
        let mut loader = MemoryFileLoader::new();
        loader.add_file(
            "/test/fixture.md",
            r#"
```typeql:schema
define entity person;
```

```typeql:data
insert $p isa person;
```

```typeql:query
match $p isa person;
```

```typeql:expect
rows: 1
```
"#,
        );

        let content = r#"
```import
./fixture.md
```

```typeql:query
match $p isa person;
```
"#;

        let parser = ScenarioParser::new();
        let scenario = parser.parse(content, Some("/test/main.md")).unwrap();
        let resolved = resolve_imports(scenario, &loader).unwrap();

        // Should only import schema + data, not query/expect
        assert_eq!(resolved.stages.len(), 3);
        assert!(matches!(resolved.stages[0].kind, StageKind::Schema(_)));
        assert!(matches!(resolved.stages[1].kind, StageKind::Data(_)));
        assert!(matches!(resolved.stages[2].kind, StageKind::Query(_))); // from main
    }

    #[test]
    fn test_circular_import_detection() {
        let mut loader = MemoryFileLoader::new();
        loader.add_file(
            "/test/a.md",
            r#"
```import
./b.md
```

```typeql:schema
define entity a;
```
"#,
        );
        loader.add_file(
            "/test/b.md",
            r#"
```import
./a.md
```

```typeql:schema
define entity b;
```
"#,
        );

        let parser = ScenarioParser::new();
        let scenario = parser.parse(
            &loader.load(Path::new("/test/a.md")).unwrap(),
            Some("/test/a.md"),
        )
        .unwrap();

        let result = resolve_imports(scenario, &loader);
        assert!(result.is_err());
        if let Err(ParseError::CircularImport { chain }) = result {
            assert!(chain.contains("a.md"));
            assert!(chain.contains("b.md"));
        } else {
            panic!("Expected CircularImport error");
        }
    }

    #[test]
    fn test_relative_path_parent() {
        let mut loader = MemoryFileLoader::new();
        loader.add_file(
            "/test/base.md",
            r#"
```typeql:schema
define attribute name, value string;
```
"#,
        );
        loader.add_file(
            "/test/fixtures/nested.md",
            r#"
```import
../base.md
```

```typeql:schema
define entity person, owns name;
```
"#,
        );

        let content = r#"
```import
./fixtures/nested.md
```

```typeql:query
match $p isa person;
```
"#;

        let parser = ScenarioParser::new();
        let scenario = parser.parse(content, Some("/test/main.md")).unwrap();
        let resolved = resolve_imports(scenario, &loader).unwrap();

        // Should resolve: /test/fixtures/nested.md -> /test/base.md
        assert_eq!(resolved.stages.len(), 3);
    }

    #[test]
    fn test_import_not_found() {
        let loader = MemoryFileLoader::new();

        let content = r#"
```import
./nonexistent.md
```
"#;

        let parser = ScenarioParser::new();
        let scenario = parser.parse(content, Some("/test/main.md")).unwrap();
        let result = resolve_imports(scenario, &loader);

        assert!(result.is_err());
        assert!(matches!(result, Err(ParseError::ImportNotFound { .. })));
    }
}
