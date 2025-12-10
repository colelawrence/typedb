/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::get,
    Router,
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "assets/studio/"]
struct StudioAssets;

/// Default base path for Studio (must match Angular's embedded build baseHref)
const DEFAULT_BASE_PATH: &str = "/studio/";

#[derive(Clone)]
pub struct StudioConfig {
    /// The base path where Studio is served (e.g., "/studio/" or "/ui/")
    pub base_path: String,
    /// Cached index.html with substituted base href
    index_html: Arc<String>,
}

impl StudioConfig {
    pub fn new(base_path: Option<String>) -> Option<Self> {
        let index_content = StudioAssets::get("index.html")?;
        let index_str = String::from_utf8_lossy(&index_content.data);
        
        let base_path = base_path.unwrap_or_else(|| DEFAULT_BASE_PATH.to_string());
        // Ensure base_path has trailing slash
        let base_path = if base_path.ends_with('/') {
            base_path
        } else {
            format!("{}/", base_path)
        };
        
        // Replace the compiled-in base href with the configured one
        let index_html = index_str.replace(
            &format!("<base href=\"{}\">", DEFAULT_BASE_PATH),
            &format!("<base href=\"{}\">", base_path),
        );
        
        Some(Self {
            base_path,
            index_html: Arc::new(index_html),
        })
    }
}

pub(crate) fn create_studio_router(base_path: Option<String>) -> Option<Router> {
    let config = StudioConfig::new(base_path)?;
    let path = config.base_path.trim_end_matches('/');
    
    Some(
        Router::new()
            .route(&path, get(redirect_to_with_slash))
            .route(&format!("{}/", path), get(serve_index))
            .route(&format!("{}/*path", path), get(serve_embedded_file))
            .with_state(config),
    )
}

async fn redirect_to_with_slash(State(config): State<StudioConfig>) -> impl IntoResponse {
    Redirect::permanent(&config.base_path)
}

async fn serve_index(State(config): State<StudioConfig>) -> impl IntoResponse {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(config.index_html.as_bytes().to_vec()))
        .unwrap()
}

async fn serve_embedded_file(
    State(config): State<StudioConfig>,
    Path(path): Path<String>,
) -> impl IntoResponse {
    serve_file(&config, &path)
}

fn serve_file(config: &StudioConfig, path: &str) -> Response {
    match StudioAssets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => {
            // SPA fallback: serve index.html for client-side routing
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .body(Body::from(config.index_html.as_bytes().to_vec()))
                .unwrap()
        }
    }
}

pub(crate) fn has_embedded_assets() -> bool {
    StudioAssets::get("index.html").is_some()
}
