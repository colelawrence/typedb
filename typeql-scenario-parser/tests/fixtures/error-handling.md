---
id: error-handling
tags: [error, validation]
---

# Error Handling Scenarios

Test that error cases are handled correctly.

## Invalid Schema - Missing Value Type

This should produce a parse error for invalid syntax.

```typeql:query
match $x isa nonexistent_type;
```

```typeql:expect
error_contains: "nonexistent"
error_type: schema
```
