/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! WASM-compatible time utilities.
//!
//! This module provides time measurement abstractions that work on both native
//! and WASM targets. On native platforms, it uses `std::time::Instant`. On WASM
//! it uses `web_time::Instant` which leverages `performance.now()` for accurate
//! timing in browser and Node.js/Bun environments.

use std::time::Duration;

/// A WASM-compatible instant for measuring elapsed time.
///
/// On native platforms, this wraps `std::time::Instant`.
/// On WASM, this wraps `web_time::Instant` for accurate timing via performance.now().
#[derive(Debug, Clone, Copy)]
pub struct MaybeInstant {
    #[cfg(not(target_arch = "wasm32"))]
    inner: std::time::Instant,
    #[cfg(target_arch = "wasm32")]
    inner: web_time::Instant,
}

impl MaybeInstant {
    /// Returns an instant corresponding to "now".
    #[inline]
    pub fn now() -> Self {
        #[cfg(not(target_arch = "wasm32"))]
        {
            Self { inner: std::time::Instant::now() }
        }
        #[cfg(target_arch = "wasm32")]
        {
            Self { inner: web_time::Instant::now() }
        }
    }

    /// Returns the amount of time elapsed since this instant.
    #[inline]
    pub fn elapsed(&self) -> Duration {
        self.inner.elapsed()
    }

    /// Returns the amount of time elapsed from another instant to this one.
    #[inline]
    pub fn duration_since(&self, earlier: Self) -> Duration {
        self.inner.duration_since(earlier.inner)
    }
}

impl Default for MaybeInstant {
    fn default() -> Self {
        Self::now()
    }
}

/// Check if time measurement is available on this platform.
///
/// Returns `true` on native platforms, `false` on WASM.
#[inline]
pub const fn is_time_available() -> bool {
    #[cfg(not(target_arch = "wasm32"))]
    {
        true
    }
    #[cfg(target_arch = "wasm32")]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_maybe_instant_does_not_panic() {
        let start = MaybeInstant::now();
        let _elapsed = start.elapsed();
        let end = MaybeInstant::now();
        let _duration = end.duration_since(start);
    }

    #[test]
    fn test_elapsed_is_non_negative() {
        let start = MaybeInstant::now();
        let elapsed = start.elapsed();
        assert!(elapsed >= Duration::ZERO);
    }
}
