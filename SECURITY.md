# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |
| Earlier development snapshots | No |

Security fixes for the supported v0.1 line are handled on a best-effort basis. No response-time SLA is promised.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository when it is available. Do not put active credentials, exploit details, private repository content, or other sensitive material in a public issue. If private reporting is unavailable, open a minimal issue asking the maintainer to provide a private channel, without including the vulnerability details.

Include the affected ContextForge version or commit, operating system, Node version, a minimal reproduction, impact, and whether the issue can expose repository content or change local state. Response and remediation are best-effort for this early open-source project; no response-time SLA is promised.

## Security boundary

ContextForge reads local repositories with the permissions of the invoking user. Repository content, tasks, parser data, Git output, and MCP inputs are untrusted. ContextForge does not execute repository source, provide shell or arbitrary-file MCP tools, upload repository data, start a network listener, or collect telemetry. Its sensitive-path and ignore policy cannot guarantee detection of every inline secret inside an otherwise eligible source file.

The SQLite WAL index is supported only on a local filesystem. Network and UNC filesystem placement is unsupported. See the README for the complete trust model and limitations.
