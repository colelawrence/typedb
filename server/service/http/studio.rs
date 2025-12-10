/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

use axum::{
    body::Body,
    extract::Path,
    http::{header, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::get,
    Router,
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "assets/studio/"]
struct StudioAssets;

pub(crate) fn create_studio_router() -> Router {
    Router::new()
        .route("/studio", get(redirect_to_studio_with_slash))
        .route("/studio/", get(serve_index))
        .route("/studio/*path", get(serve_embedded_file))
}

async fn redirect_to_studio_with_slash() -> impl IntoResponse {
    Redirect::permanent("/studio/")
}

async fn serve_index() -> impl IntoResponse {
    serve_file("index.html")
}

async fn serve_embedded_file(Path(path): Path<String>) -> impl IntoResponse {
    serve_file(&path)
}

fn serve_file(path: &str) -> Response {
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
            match StudioAssets::get("index.html") {
                Some(content) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/html")
                    .body(Body::from(content.data.into_owned()))
                    .unwrap(),
                None => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Body::from("Studio assets not found"))
                    .unwrap(),
            }
        }
    }
}

pub(crate) fn has_embedded_assets() -> bool {
    StudioAssets::get("index.html").is_some()
}
