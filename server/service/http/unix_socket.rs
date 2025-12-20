/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! Unix socket HTTP serving support.
//!
//! Note: axum 0.7.x does not have native Unix socket support with IncomingStream,
//! so Unix socket serving is implemented using hyper 0.14 directly in lib.rs.
//! This module exists for organizational purposes and may be expanded in the future
//! when upgrading to axum 0.8+.
