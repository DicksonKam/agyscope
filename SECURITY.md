# Security

- The local HTTP service binds strictly to `127.0.0.1` and enforces `Host` and `Origin` checks.
- State-changing `POST` endpoints require `Content-Type: application/json`, a loopback `Origin`, and a per-run CSRF token (`X-AGYScope-Token`) compared in constant time.
- AGYScope never reads keychain items, OAuth tokens, cookies, or browser profiles. An automated test (`tests/usage-reader.test.ts`) fails if credential-reading or direct API code is added.
- Uninstalling the service or menu bar app moves only recognized AGYScope files to Trash and never deletes history.
