/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

#![cfg(unix)]

use std::sync::Arc;

use axum::extract::connect_info;
use axum::serve::IncomingStream;
use tokio::net::{unix::UCred, UnixListener};
use tracing::warn;

#[derive(Clone, Debug)]
pub(crate) struct UdsConnectInfo {
    pub(crate) peer_addr: Option<Arc<tokio::net::unix::SocketAddr>>,
    pub(crate) peer_cred: Option<UCred>,
}

impl connect_info::Connected<IncomingStream<'_, UnixListener>> for UdsConnectInfo {
    fn connect_info(stream: IncomingStream<'_, UnixListener>) -> Self {
        let peer_addr = match stream.io().peer_addr() {
            Ok(addr) => Some(Arc::new(addr)),
            Err(error) => {
                warn!("Failed to read Unix socket peer address: {error}");
                None
            }
        };
        let peer_cred = match stream.io().peer_cred() {
            Ok(cred) => Some(cred),
            Err(error) => {
                warn!("Failed to read Unix socket peer credentials: {error}");
                None
            }
        };
        Self {
            peer_addr,
            peer_cred,
        }
    }
}
