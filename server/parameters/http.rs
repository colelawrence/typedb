/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

use std::{fmt, net::SocketAddr, path::PathBuf};

use tokio::net::lookup_host;

use crate::parameters::config::HttpEndpointConfig;

#[derive(Clone, Debug)]
pub enum HttpListenAddress {
    Tcp(SocketAddr),
    Unix(PathBuf),
}

impl HttpListenAddress {
    pub async fn resolve_tcp(address: String) -> SocketAddr {
        lookup_host(address.clone())
            .await
            .unwrap()
            .next()
            .unwrap_or_else(|| panic!("Unable to map address '{}' to any IP addresses", address))
    }

    pub async fn from_config(config: &HttpEndpointConfig) -> Option<Self> {
        if let Some(socket_path) = config.unix_socket.as_ref() {
            return Some(HttpListenAddress::Unix(socket_path.clone()));
        }

        if let Some(address) = config.address.as_ref() {
            return Some(HttpListenAddress::Tcp(Self::resolve_tcp(address.clone()).await));
        }

        None
    }
}

impl fmt::Display for HttpListenAddress {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HttpListenAddress::Tcp(address) => write!(f, "tcp://{address}"),
            HttpListenAddress::Unix(path) => write!(f, "unix://{}", path.display()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::HttpListenAddress;
    use crate::parameters::config::{HttpEndpointConfig, StudioConfig};

    #[test]
    fn http_listen_address_display_tcp() {
        let address = "127.0.0.1:8000".parse().expect("expected socket addr");
        assert_eq!(HttpListenAddress::Tcp(address).to_string(), "tcp://127.0.0.1:8000");
    }

    #[test]
    fn http_listen_address_display_unix() {
        let address = HttpListenAddress::Unix("/tmp/typedb.sock".into());
        assert_eq!(address.to_string(), "unix:///tmp/typedb.sock");
    }

    #[tokio::test]
    async fn http_listen_address_from_config_tcp() {
        let config = HttpEndpointConfig {
            enabled: true,
            address: Some("127.0.0.1:8000".to_string()),
            unix_socket: None,
            studio: StudioConfig::default(),
        };
        let address = HttpListenAddress::from_config(&config).await.expect("expected tcp address");
        assert!(matches!(address, HttpListenAddress::Tcp(_)));
    }

    #[tokio::test]
    async fn http_listen_address_from_config_unix() {
        let config = HttpEndpointConfig {
            enabled: true,
            address: None,
            unix_socket: Some("/tmp/typedb.sock".into()),
            studio: StudioConfig::default(),
        };
        let address = HttpListenAddress::from_config(&config).await.expect("expected unix address");
        assert!(matches!(address, HttpListenAddress::Unix(_)));
    }
}
