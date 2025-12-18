/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Parser for TypeQL scenario Markdown files.

use crate::models::*;
use std::collections::HashMap;
use std::path::Path;

/// Parser for TypeQL scenario files.
pub struct ScenarioParser {
    /// Whether to require an ID in front matter.
    pub require_id: bool,
}

impl Default for ScenarioParser {
    fn default() -> Self {
        Self::new()
    }
}

impl ScenarioParser {
    /// Create a new parser with default settings.
    pub fn new() -> Self {
        Self { require_id: false }
    }

    /// Parse a scenario from a string.
    pub fn parse(&self, content: &str, source_path: Option<&str>) -> Result<Scenario, ParseError> {
        let mut scenario = Scenario::new(
            source_path
                .map(|p| Path::new(p).file_stem().map(|s| s.to_string_lossy().to_string()))
                .flatten()
                .unwrap_or_else(|| "unnamed".to_string()),
        );
        scenario.source_path = source_path.map(|s| s.to_string());

        let lines: Vec<&str> = content.lines().collect();
        let mut line_idx = 0;

        // Parse front matter if present
        if lines.first().map(|l| l.trim()) == Some("---") {
            line_idx = self.parse_front_matter(&lines, &mut scenario)?;
        }

        // Parse title from first heading
        while line_idx < lines.len() {
            let line = lines[line_idx].trim();
            if line.starts_with("# ") {
                scenario.title = Some(line[2..].trim().to_string());
                line_idx += 1;
                break;
            } else if !line.is_empty() {
                break;
            }
            line_idx += 1;
        }

        // Collect description until first code block
        let mut description_lines = Vec::new();
        while line_idx < lines.len() {
            let line = lines[line_idx];
            if line.trim().starts_with("```") {
                break;
            }
            if !line.trim().is_empty() || !description_lines.is_empty() {
                description_lines.push(line);
            }
            line_idx += 1;
        }
        if !description_lines.is_empty() {
            scenario.description = Some(
                description_lines
                    .iter()
                    .map(|s| s.trim())
                    .collect::<Vec<_>>()
                    .join("\n")
                    .trim()
                    .to_string(),
            );
        }

        // Parse code blocks
        while line_idx < lines.len() {
            let line = lines[line_idx].trim();
            if line.starts_with("```") {
                let (stage, end_idx) =
                    self.parse_code_block(&lines, line_idx)?;
                scenario.stages.push(stage);
                line_idx = end_idx + 1;
            } else {
                line_idx += 1;
            }
        }

        Ok(scenario)
    }

    /// Parse a scenario from a file.
    pub fn parse_file(&self, path: &Path) -> Result<Scenario, ParseError> {
        let content =
            std::fs::read_to_string(path).map_err(|e| ParseError::Io(e.to_string()))?;
        self.parse(&content, Some(&path.to_string_lossy()))
    }

    /// Parse front matter (YAML-like format between `---` markers).
    fn parse_front_matter(
        &self,
        lines: &[&str],
        scenario: &mut Scenario,
    ) -> Result<usize, ParseError> {
        let mut idx = 1; // Skip opening `---`
        let mut front_matter = HashMap::new();

        while idx < lines.len() {
            let line = lines[idx];
            if line.trim() == "---" {
                idx += 1;
                break;
            }

            // Simple key: value parsing
            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim();
                let value = value.trim();

                // Handle arrays like [tag1, tag2]
                let parsed_value = if value.starts_with('[') && value.ends_with(']') {
                    let inner = &value[1..value.len() - 1];
                    let items: Vec<serde_json::Value> = inner
                        .split(',')
                        .map(|s| serde_json::Value::String(s.trim().to_string()))
                        .collect();
                    serde_json::Value::Array(items)
                } else {
                    serde_json::Value::String(value.to_string())
                };

                front_matter.insert(key.to_string(), parsed_value);
            }
            idx += 1;
        }

        // Extract known fields
        if let Some(serde_json::Value::String(id)) = front_matter.remove("id") {
            scenario.id = id;
        }
        if let Some(serde_json::Value::Array(tags)) = front_matter.remove("tags") {
            scenario.tags = tags
                .into_iter()
                .filter_map(|v| {
                    if let serde_json::Value::String(s) = v {
                        Some(s)
                    } else {
                        None
                    }
                })
                .collect();
        }
        scenario.metadata = front_matter;

        Ok(idx)
    }

    /// Parse a fenced code block.
    fn parse_code_block(
        &self,
        lines: &[&str],
        start_idx: usize,
    ) -> Result<(Stage, usize), ParseError> {
        let opening_line = lines[start_idx].trim();
        let line_number = start_idx + 1; // 1-indexed

        // Extract language/type from opening fence
        let fence_info = opening_line.trim_start_matches('`');
        let (block_type, label) = self.parse_fence_info(fence_info);

        // Collect content until closing fence
        let mut content_lines = Vec::new();
        let mut idx = start_idx + 1;
        while idx < lines.len() {
            let line = lines[idx];
            if line.trim().starts_with("```") {
                break;
            }
            content_lines.push(line);
            idx += 1;
        }

        let content = content_lines.join("\n");
        let mut stage = self.create_stage(&block_type, &content, line_number)?;

        if let Some(label) = label {
            stage.label = Some(label);
        }
        stage.line_number = Some(line_number);
        stage.raw_source = Some(content);

        Ok((stage, idx))
    }

    /// Parse fence info like "typeql:schema" or "typeql:query label"
    fn parse_fence_info(&self, info: &str) -> (String, Option<String>) {
        let parts: Vec<&str> = info.split_whitespace().collect();
        let block_type = parts.first().unwrap_or(&"").to_string();
        let label = parts.get(1).map(|s| s.to_string());
        (block_type, label)
    }

    /// Create a stage from block type and content.
    fn create_stage(
        &self,
        block_type: &str,
        content: &str,
        line_number: usize,
    ) -> Result<Stage, ParseError> {
        match block_type {
            "typeql:schema" | "typeql:define" => Ok(Stage::schema(content)),
            "typeql:data" | "typeql:insert" | "typeql:execute" => Ok(Stage::data(content)),
            "typeql:query" | "typeql:match" | "typeql:read" => Ok(Stage::query(content)),
            "typeql:expect" | "typeql:expectation" => {
                let expectation = self.parse_expectation(content, line_number)?;
                Ok(Stage::expect(expectation))
            }
            "typeql:error" => {
                let expectation = Expectation {
                    error_contains: Some(content.trim().to_string()),
                    ..Default::default()
                };
                Ok(Stage::expect(expectation))
            }
            "typeql" | "typeql:raw" => Ok(Stage::new(StageKind::Raw(content.to_string()))),
            // Ignore non-typeql blocks
            _ if !block_type.starts_with("typeql") => {
                Ok(Stage::new(StageKind::Raw(String::new())))
            }
            _ => Err(ParseError::UnknownBlockType {
                line: line_number,
                block_type: block_type.to_string(),
            }),
        }
    }

    /// Parse expectation content.
    fn parse_expectation(&self, content: &str, line_number: usize) -> Result<Expectation, ParseError> {
        let mut expectation = Expectation::default();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim();
                let value = value.trim();

                match key {
                    "rows" => {
                        expectation.rows = Some(value.parse().map_err(|_| {
                            ParseError::InvalidExpectation {
                                line: line_number,
                                message: format!("Invalid row count: {}", value),
                            }
                        })?);
                    }
                    "columns" => {
                        expectation.columns = Some(self.parse_string_array(value)?);
                    }
                    "error_contains" | "error" => {
                        expectation.error_contains = Some(value.trim_matches('"').to_string());
                    }
                    "error_type" => {
                        expectation.error_type = Some(match value {
                            "parse" => ExpectedErrorType::Parse,
                            "schema" => ExpectedErrorType::Schema,
                            "data" => ExpectedErrorType::Data,
                            _ => ExpectedErrorType::Any,
                        });
                    }
                    "numeric_tolerance" => {
                        expectation.numeric_tolerance = Some(value.parse().map_err(|_| {
                            ParseError::InvalidExpectation {
                                line: line_number,
                                message: format!("Invalid numeric tolerance: {}", value),
                            }
                        })?);
                    }
                    "values" => {
                        expectation.values = Some(
                            serde_json::from_str(value).map_err(|e| {
                                ParseError::InvalidExpectation {
                                    line: line_number,
                                    message: format!("Invalid values JSON: {}", e),
                                }
                            })?,
                        );
                    }
                    "values_unordered" => {
                        expectation.values_unordered = Some(
                            serde_json::from_str(value).map_err(|e| {
                                ParseError::InvalidExpectation {
                                    line: line_number,
                                    message: format!("Invalid values JSON: {}", e),
                                }
                            })?,
                        );
                    }
                    _ => {}
                }
            }
        }

        Ok(expectation)
    }

    /// Parse a string array like "[a, b, c]".
    fn parse_string_array(&self, value: &str) -> Result<Vec<String>, ParseError> {
        let trimmed = value.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let inner = &trimmed[1..trimmed.len() - 1];
            Ok(inner
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect())
        } else {
            Ok(vec![trimmed.to_string()])
        }
    }
}

/// Parse a scenario file from a path.
pub fn parse_file(path: &Path) -> Result<Scenario, ParseError> {
    ScenarioParser::new().parse_file(path)
}

/// Parse a scenario from a string.
pub fn parse(content: &str) -> Result<Scenario, ParseError> {
    ScenarioParser::new().parse(content, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_scenario() {
        let content = r#"---
id: test-scenario
tags: [basic, query]
---

# Test Scenario

This tests basic functionality.

```typeql:schema
define
attribute name, value string;
entity person, owns name;
```

```typeql:data
insert $p isa person, has name "Alice";
```

```typeql:query
match $p isa person, has name $n;
```

```typeql:expect
rows: 1
columns: [p, n]
```
"#;

        let scenario = parse(content).unwrap();
        assert_eq!(scenario.id, "test-scenario");
        assert_eq!(scenario.title, Some("Test Scenario".to_string()));
        assert_eq!(scenario.tags, vec!["basic", "query"]);
        assert_eq!(scenario.stages.len(), 4);

        assert!(matches!(scenario.stages[0].kind, StageKind::Schema(_)));
        assert!(matches!(scenario.stages[1].kind, StageKind::Data(_)));
        assert!(matches!(scenario.stages[2].kind, StageKind::Query(_)));
        assert!(matches!(scenario.stages[3].kind, StageKind::Expect(_)));
    }

    #[test]
    fn test_parse_expectation() {
        let content = r#"
```typeql:query
match $p isa person;
```

```typeql:expect
rows: 5
columns: [p]
```
"#;

        let scenario = parse(content).unwrap();
        if let StageKind::Expect(exp) = &scenario.stages[1].kind {
            assert_eq!(exp.rows, Some(5));
            assert_eq!(exp.columns, Some(vec!["p".to_string()]));
        } else {
            panic!("Expected expectation stage");
        }
    }

    #[test]
    fn test_parse_error_expectation() {
        let content = r#"
```typeql:query
match $x isa nonexistent;
```

```typeql:expect
error_contains: "not found"
error_type: schema
```
"#;

        let scenario = parse(content).unwrap();
        if let StageKind::Expect(exp) = &scenario.stages[1].kind {
            assert_eq!(exp.error_contains, Some("not found".to_string()));
            assert_eq!(exp.error_type, Some(ExpectedErrorType::Schema));
        } else {
            panic!("Expected expectation stage");
        }
    }
}
