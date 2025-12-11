# Recovery Token & Service Account Design

This document outlines the design for privileged token creation, enabling cloud console recovery scenarios and future service account capabilities.

## Problem Statement

Users may lose their username/password credentials and need a recovery path. The cloud console needs a secure way to:
1. Generate authentication tokens for users who lost credentials
2. Perform administrative operations without storing user passwords

Currently, `token_create_for_startup()` creates tokens without password verification, but is only used internally at server startup for the auto-login URL feature.

## Current Auto-Login Architecture

The existing auto-login flow (for reference):

```
Server Startup
     │
     ▼
token_create_for_startup("admin")
     │
     ▼
Generate JWT (no password check)
     │
     ▼
Print URL: http://localhost:8000/studio/#<JWT>
     │
     ▼
User opens URL → Studio extracts JWT → API calls with Bearer token
```

Key files:
- `server/authentication/token_manager.rs` - JWT creation/validation
- `server/state.rs` - `token_create_for_startup()` method
- `server/lib.rs` - URL generation at startup
- `server/parameters/config.rs` - `auto_login_token` config flag

## Recommended Design: Config-Driven Recovery Key

### Overview

Use a symmetric "recovery key" configured on the server, sent by the cloud console on each privileged call. This reuses existing JWT machinery while adding explicit security controls.

### Why This Approach?

| Alternative | Why Not |
|------------|---------|
| Reuse `token_create_for_startup` | No security checks; mixing startup convenience with remote control risks accidental exposure |
| Global "root" user / master JWT | Tends to sprawl; bypasses auditing; encourages misuse for non-emergency tasks |
| mTLS for console | Higher complexity; requires client cert infrastructure; overkill for initial implementation |

Benefits of recovery key approach:
- Reuses existing `TokenManager`, authenticators, and `PermissionManager`
- Single header check in one endpoint
- Easy to disable for self-managed deployments
- Console gets user-scoped tokens, so all permission checks still apply

## Implementation Plan

### 1. Configuration Layer

Extend `AuthenticationConfig` in `server/parameters/config.rs`:

```rust
#[serde_as]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct AuthenticationConfig {
    #[serde_as(as = "DurationSeconds")]
    #[serde(rename = "token-expiration-seconds")]
    pub token_expiration: Duration,

    /// Optional secret used by the cloud console to invoke privileged recovery APIs.
    /// If absent, the recovery endpoint is disabled.
    /// Must be a high-entropy random string (32+ bytes, base64 recommended).
    #[serde(default)]
    pub recovery_key: Option<String>,

    /// Explicit guard to enable recovery endpoint.
    /// If true but recovery_key is None, server should fail startup.
    #[serde(default)]
    pub enable_recovery_endpoint: bool,

    /// Optional shorter expiration for recovery tokens (seconds).
    /// If unset, uses standard token_expiration.
    #[serde(default)]
    pub recovery_token_expiration_seconds: Option<u64>,
}
```

Add CLI args in `server/parameters/cli.rs`:

```rust
#[arg(long = "server.authentication.recovery-key", env = "TYPEDB_RECOVERY_KEY")]
pub server_authentication_recovery_key: Option<String>,

#[arg(long = "server.authentication.enable-recovery-endpoint")]
pub server_authentication_enable_recovery_endpoint: Option<bool>,
```

### 2. Server State

Add to `LocalServerState` in `server/state.rs`:

```rust
#[derive(Debug)]
pub struct LocalServerState {
    // ... existing fields ...
    recovery_key: Option<String>,
    recovery_endpoint_enabled: bool,
}
```

Add trait method to `ServerState`:

```rust
#[async_trait]
pub trait ServerState: Debug {
    // ... existing methods ...

    /// Creates a token for the given username without password verification,
    /// under a privileged recovery context.
    /// 
    /// Returns error if user does not exist.
    async fn token_create_for_recovery(&self, username: String) -> Result<String, AuthenticationError>;

    /// Whether the recovery endpoint is enabled and properly configured.
    fn recovery_endpoint_enabled(&self) -> bool;

    /// Validates a recovery key (constant-time comparison).
    fn validate_recovery_key(&self, provided: &str) -> bool;
}
```

Implementation:

```rust
async fn token_create_for_recovery(&self, username: String) -> Result<String, AuthenticationError> {
    // Verify user exists before minting token
    if !self.user_manager.contains(&username).unwrap_or(false) {
        return Err(AuthenticationError::UserDoesNotExist);
    }
    Ok(self.token_manager.new_token(username).await)
}

fn recovery_endpoint_enabled(&self) -> bool {
    self.recovery_endpoint_enabled && self.recovery_key.is_some()
}

fn validate_recovery_key(&self, provided: &str) -> bool {
    match &self.recovery_key {
        Some(key) => constant_time_eq(provided.as_bytes(), key.as_bytes()),
        None => false,
    }
}
```

### 3. HTTP Endpoint

Add route in `http::typedb_service`:

```
POST /admin/recovery/token
```

Request:
```json
{
  "username": "lost-user"
}
```

Response:
```json
{
  "token": "eyJhbG..."
}
```

Headers:
- `X-TypeDB-Recovery-Key: <configured_recovery_key>`

Handler pseudocode:

```rust
async fn create_recovery_token(
    State(server_state): State<Arc<BoxServerState>>,
    State(tls_enabled): State<bool>,
    headers: HeaderMap,
    Json(body): Json<RecoveryTokenRequest>,
) -> Result<Json<RecoveryTokenResponse>, StatusCode> {
    // 1. Check feature is enabled
    if !server_state.recovery_endpoint_enabled() {
        return Err(StatusCode::NOT_FOUND);
    }

    // 2. Require TLS - never allow over plain HTTP
    if !tls_enabled {
        warn!("Recovery endpoint called over non-TLS connection, rejecting");
        return Err(StatusCode::FORBIDDEN);
    }

    // 3. Validate recovery key
    let provided_key = headers
        .get("X-TypeDB-Recovery-Key")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if !server_state.validate_recovery_key(provided_key) {
        warn!("Invalid recovery key provided");
        return Err(StatusCode::UNAUTHORIZED);
    }

    // 4. Audit log
    info!(
        "Recovery token requested for user '{}' from {}",
        body.username,
        // extract remote IP if available
    );

    // 5. Create token
    let token = server_state
        .token_create_for_recovery(body.username.clone())
        .await
        .map_err(|e| {
            warn!("Recovery token creation failed for '{}': {:?}", body.username, e);
            StatusCode::BAD_REQUEST
        })?;

    info!("Recovery token created for user '{}'", body.username);
    Ok(Json(RecoveryTokenResponse { token }))
}
```

### 4. Startup Validation

In server initialization, add validation:

```rust
if config.server.authentication.enable_recovery_endpoint {
    if config.server.authentication.recovery_key.is_none() {
        return Err(StartupError::Configuration(
            "enable_recovery_endpoint is true but no recovery_key is configured".into()
        ));
    }
    
    if !config.server.encryption.enabled {
        return Err(StartupError::Configuration(
            "Recovery endpoint requires TLS to be enabled (server.encryption.enabled = true)".into()
        ));
    }

    // Optional: warn if recovery key looks weak
    if let Some(key) = &config.server.authentication.recovery_key {
        if key.len() < 32 {
            warn!("recovery_key is shorter than recommended 32 characters");
        }
    }
}
```

## Security Requirements

### Mandatory Guardrails

1. **TLS Required**
   - Recovery endpoint refuses to operate unless `server.encryption.enabled == true`
   - Fail startup if recovery enabled without TLS

2. **Opt-in Only**
   - `enable_recovery_endpoint` defaults to `false`
   - Must be explicitly enabled in config

3. **Strong Secret**
   - `recovery_key` must be high-entropy (recommend 32+ bytes, base64)
   - Load from environment variable or secret manager, not config file
   - Example: `TYPEDB_RECOVERY_KEY=$(openssl rand -base64 32)`

4. **Constant-Time Comparison**
   - Use `constant_time_eq` or equivalent to prevent timing attacks

5. **Audit Logging**
   - Log every recovery token creation at INFO/WARN level
   - Include: username, timestamp, source IP (if available)
   - Never log the token value or recovery key

### Recommended Guardrails

1. **Network Isolation**
   - Recovery endpoint should only be accessible from control plane network
   - Consider IP allowlisting or firewall rules

2. **Rate Limiting**
   - Limit requests per source IP and per username
   - Prevent brute-force attacks on recovery key

3. **Short Token Expiration**
   - Consider shorter expiration for recovery tokens via `recovery_token_expiration_seconds`
   - User should reset password immediately after recovery

4. **Token Invalidation**
   - Existing `token_manager.invalidate_user(name)` already invalidates all tokens on password change
   - Recovery token becomes invalid once user resets password

## Token Behavior

Recovery tokens are **standard JWTs** with:
- `sub` (subject) = username
- `exp` (expiration) = standard or recovery-specific expiration
- `iat` (issued at) = current timestamp

They flow through the same authentication path:
1. Client sends `Authorization: Bearer <token>`
2. `http::authenticator` / `grpc::authenticator` validates JWT
3. `PermissionManager` enforces user's permissions

This means the console doesn't get elevated privileges—it gets a token scoped to that specific user, subject to all normal permission checks.

## Usage Example

### Server Configuration

```yaml
server:
  encryption:
    enabled: true
    # ... TLS config ...
  
  authentication:
    token-expiration-seconds: 86400
    enable-recovery-endpoint: true
    # Loaded from environment: TYPEDB_RECOVERY_KEY
```

### Cloud Console Request

```bash
curl -X POST https://typedb-server:8000/admin/recovery/token \
  -H "Content-Type: application/json" \
  -H "X-TypeDB-Recovery-Key: ${RECOVERY_KEY}" \
  -d '{"username": "lost-user"}'
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9..."
}
```

### Console Flow

1. User reports lost credentials to cloud support
2. Support verifies user identity out-of-band
3. Console calls recovery endpoint to mint token
4. Console provides token to user (or uses it to initiate password reset flow)
5. User authenticates with token, resets password
6. Old tokens (including recovery token) are invalidated

## Future Extensions

### Service Accounts (Advanced Path)

When multi-tenant or fine-grained console permissions are needed:

```yaml
service_accounts:
  - id: "cloud-console-prod"
    secret: "${CONSOLE_SECRET}"
    scopes:
      - "recovery:create_token"
      - "users:read"
  - id: "monitoring-agent"
    secret: "${MONITORING_SECRET}"
    scopes:
      - "diagnostics:read"
```

This would require:
- Service account abstraction in config or system DB
- JWT claims with `iss`/`aud`/`scope` fields
- Extended authenticator to handle service account tokens
- Scope-based permission mapping

### mTLS-Bound Service Accounts

For highest security:
- Configure CA for console client certificates
- Map client cert CN/SAN to service account identity
- No explicit recovery key header needed; identity from TLS handshake

## Effort Estimate

| Component | Effort |
|-----------|--------|
| Config layer changes | S (30 min) |
| Server state methods | S (30 min) |
| HTTP endpoint + handler | M (1-2 hr) |
| Startup validation | S (30 min) |
| Testing | M (1-2 hr) |
| **Total (simple path)** | **M (3-5 hr)** |

Advanced service account/mTLS path: L-XL depending on scope.

## References

- `server/authentication/token_manager.rs` - JWT implementation
- `server/state.rs` - ServerState trait and LocalServerState
- `server/parameters/config.rs` - Configuration structures
- `server/http/typedb_service.rs` - HTTP routing
- `studio/src/service/auto-login.service.ts` - Client-side token handling example
