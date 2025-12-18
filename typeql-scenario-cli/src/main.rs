/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! TypeQL Scenario CLI
//!
//! Command-line tool for running TypeQL scenario tests.

use clap::{Parser, Subcommand};
use colored::Colorize;
use std::path::PathBuf;
use std::process::ExitCode;
use typeql_scenario_parser::ScenarioParser;
use typeql_scenario_runner::{MockBackend, RunSummary, RunnerConfig, ScenarioRunner};

#[derive(Parser)]
#[command(name = "typeql-scenario")]
#[command(about = "Run TypeQL scenario tests", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Check scenario files for syntax errors
    Check {
        /// Path to scenario file or directory
        #[arg(default_value = ".")]
        path: PathBuf,

        /// Recursive directory search
        #[arg(short, long)]
        recursive: bool,
    },

    /// Run scenario tests
    Run {
        /// Path to scenario file or directory
        #[arg(default_value = ".")]
        path: PathBuf,

        /// Recursive directory search
        #[arg(short, long)]
        recursive: bool,

        /// Stop on first failure
        #[arg(long)]
        fail_fast: bool,

        /// Backend to use (embedded, mock)
        #[arg(long, default_value = "mock")]
        backend: String,

        /// Filter scenarios by ID pattern
        #[arg(long)]
        filter: Option<String>,

        /// Output format (text, json)
        #[arg(long, default_value = "text")]
        format: String,
    },

    /// List available scenarios
    List {
        /// Path to scenario file or directory
        #[arg(default_value = ".")]
        path: PathBuf,

        /// Recursive directory search
        #[arg(short, long)]
        recursive: bool,

        /// Filter by tag
        #[arg(long)]
        tag: Option<String>,
    },

    /// Update expectation snapshots
    UpdateSnapshots {
        /// Path to scenario file or directory
        #[arg(default_value = ".")]
        path: PathBuf,

        /// Recursive directory search
        #[arg(short, long)]
        recursive: bool,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();

    match cli.command {
        Commands::Check { path, recursive } => {
            if let Err(e) = cmd_check(&path, recursive) {
                eprintln!("{}: {}", "Error".red(), e);
                return ExitCode::FAILURE;
            }
        }
        Commands::Run {
            path,
            recursive,
            fail_fast,
            backend,
            filter,
            format,
        } => {
            match cmd_run(&path, recursive, fail_fast, &backend, filter.as_deref(), &format).await {
                Ok(success) if success => {}
                Ok(_) => return ExitCode::FAILURE,
                Err(e) => {
                    eprintln!("{}: {}", "Error".red(), e);
                    return ExitCode::FAILURE;
                }
            }
        }
        Commands::List { path, recursive, tag } => {
            if let Err(e) = cmd_list(&path, recursive, tag.as_deref()) {
                eprintln!("{}: {}", "Error".red(), e);
                return ExitCode::FAILURE;
            }
        }
        Commands::UpdateSnapshots { path: _, recursive: _ } => {
            eprintln!("{}: Snapshot updates not yet implemented", "Warning".yellow());
            // TODO: Implement snapshot updates
        }
    }

    ExitCode::SUCCESS
}

fn find_scenario_files(path: &PathBuf, recursive: bool) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();

    if path.is_file() {
        if path.extension().map(|e| e == "md").unwrap_or(false) {
            files.push(path.clone());
        }
    } else if path.is_dir() {
        let pattern = if recursive { "**/*.md" } else { "*.md" };
        let glob_pattern = format!("{}/{}", path.display(), pattern);

        for entry in glob::glob(&glob_pattern).map_err(|e| e.to_string())? {
            match entry {
                Ok(p) => files.push(p),
                Err(e) => eprintln!("{}: {}", "Warning".yellow(), e),
            }
        }
    } else {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    Ok(files)
}

fn cmd_check(path: &PathBuf, recursive: bool) -> Result<(), String> {
    let files = find_scenario_files(path, recursive)?;
    let parser = ScenarioParser::new();
    let mut errors = 0;

    for file in &files {
        match parser.parse_file(file) {
            Ok(scenario) => {
                println!(
                    "{} {} ({})",
                    "✓".green(),
                    scenario.id,
                    file.display()
                );
            }
            Err(e) => {
                eprintln!(
                    "{} {}: {}",
                    "✗".red(),
                    file.display(),
                    e
                );
                errors += 1;
            }
        }
    }

    if errors > 0 {
        Err(format!("{} file(s) with errors", errors))
    } else {
        println!("\n{} All {} files parsed successfully", "✓".green(), files.len());
        Ok(())
    }
}

async fn cmd_run(
    path: &PathBuf,
    recursive: bool,
    fail_fast: bool,
    backend_name: &str,
    filter: Option<&str>,
    format: &str,
) -> Result<bool, String> {
    let files = find_scenario_files(path, recursive)?;
    let parser = ScenarioParser::new();

    // Parse all scenarios
    let mut scenarios = Vec::new();
    for file in &files {
        match parser.parse_file(file) {
            Ok(scenario) => {
                // Apply filter
                if let Some(pattern) = filter {
                    if !scenario.id.contains(pattern) {
                        continue;
                    }
                }
                scenarios.push(scenario);
            }
            Err(e) => {
                eprintln!("{}: {}: {}", "Parse error".red(), file.display(), e);
                return Err(format!("Failed to parse {}", file.display()));
            }
        }
    }

    if scenarios.is_empty() {
        println!("No scenarios found");
        return Ok(true);
    }

    // Create backend
    let backend: Box<dyn typeql_scenario_runner::TypeQLBackend> = match backend_name {
        "mock" => Box::new(MockBackend::new()),
        "embedded" => {
            // TODO: Implement embedded backend
            eprintln!("{}: Embedded backend not yet implemented, using mock", "Warning".yellow());
            Box::new(MockBackend::new())
        }
        _ => return Err(format!("Unknown backend: {}", backend_name)),
    };

    // Create runner
    let config = RunnerConfig {
        fail_fast,
        ..Default::default()
    };
    let mut runner = ScenarioRunner::with_config(backend, config);

    // Run scenarios
    let mut summary = RunSummary::new();
    for scenario in &scenarios {
        print!("Running {}... ", scenario.id);
        let result = runner.run(scenario).await;

        if result.success {
            println!("{}", "PASS".green());
        } else {
            println!("{}", "FAIL".red());
            for stage in &result.stage_results {
                if !stage.success {
                    if let Some(ref error) = stage.error {
                        eprintln!("  Stage {}: {}", stage.index, error);
                    }
                    for diff in &stage.differences {
                        eprintln!("  {}", diff);
                    }
                }
            }
        }

        let should_stop = !result.success && fail_fast;
        summary.add(result);

        if should_stop {
            break;
        }
    }

    // Print summary
    println!();
    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(&summary).unwrap());
        }
        _ => {
            println!(
                "Results: {} passed, {} failed, {} total ({:.2}s)",
                summary.passed.to_string().green(),
                if summary.failed > 0 {
                    summary.failed.to_string().red()
                } else {
                    summary.failed.to_string().normal()
                },
                summary.total,
                summary.duration.as_secs_f64()
            );
        }
    }

    Ok(summary.all_passed())
}

fn cmd_list(path: &PathBuf, recursive: bool, tag_filter: Option<&str>) -> Result<(), String> {
    let files = find_scenario_files(path, recursive)?;
    let parser = ScenarioParser::new();

    let mut count = 0;
    for file in &files {
        match parser.parse_file(file) {
            Ok(scenario) => {
                // Apply tag filter
                if let Some(tag) = tag_filter {
                    if !scenario.tags.contains(&tag.to_string()) {
                        continue;
                    }
                }

                count += 1;
                println!(
                    "{} {} {}",
                    scenario.id.cyan(),
                    if !scenario.tags.is_empty() {
                        format!("[{}]", scenario.tags.join(", ")).dimmed()
                    } else {
                        "".dimmed()
                    },
                    file.display().to_string().dimmed()
                );
                if let Some(ref title) = scenario.title {
                    println!("  {}", title);
                }
            }
            Err(e) => {
                eprintln!("{}: {}: {}", "Parse error".red(), file.display(), e);
            }
        }
    }

    println!("\n{} scenario(s) found", count);
    Ok(())
}
