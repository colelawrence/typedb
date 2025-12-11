/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

//! WASM-compatible time utilities.
//!
//! This module provides time measurement abstractions that work on both native
//! and WASM targets. On native platforms, it uses `std::time::Instant`. On WASM
//! (wasm32 architecture), it provides a no-op implementation since monotonic
//! clocks are not available on `wasm32-unknown-unknown`.
//!
//! # Why This Exists
//!
//! The `wasm32-unknown-unknown` target does not provide access to system time,
//! so `std::time::Instant::now()` will panic with:
//! "time not implemented on this platform"
//!
//! This module allows profiling code to compile and run on WASM without panicking,
//! while still providing accurate timing on native platforms.

use std::time::Duration;

/// A WASM-compatible instant for measuring elapsed time.
///
/// On native platforms, this wraps `std::time::Instant`.
/// On WASM, this is a no-op that always returns zero duration.
#[derive(Debug, Clone, Copy)]
pub struct MaybeInstant {
    #[cfg(not(target_arch = "wasm32"))]
    inner: std::time::Instant,
    #[cfg(target_arch = "wasm32")]
    _phantom: (),
}

impl MaybeInstant {
    /// Returns an instant corresponding to "now".
    ///
    /// On WASM, this returns a placeholder instant that will always
    /// report zero elapsed time.
    #[inline]
    pub fn now() -> Self {
        #[cfg(not(target_arch = "wasm32"))]
        {
            Self { inner: std::time::Instant::now() }
        }
        #[cfg(target_arch = "wasm32")]
        {
            Self { _phantom: () }
        }
    }

    /// Returns the amount of time elapsed since this instant.
    ///
    /// On WASM, this always returns `Duration::ZERO`.
    #[inline]
    pub fn elapsed(&self) -> Duration {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.inner.elapsed()
        }
        #[cfg(target_arch = "wasm32")]
        {
            Duration::ZERO
        }
    }

    /// Returns the amount of time elapsed from another instant to this one.
    ///
    /// On WASM, this always returns `Duration::ZERO`.
    #[inline]
    pub fn duration_since(&self, _earlier: Self) -> Duration {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.inner.duration_since(_earlier.inner)
        }
        #[cfg(target_arch = "wasm32")]
        {
            Duration::ZERO
        }
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
