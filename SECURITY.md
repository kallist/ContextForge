# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.3.x | Yes |
| 0.2.x | Best effort |
| 0.1.x | Best effort |
| Earlier development snapshots | No |

Security fixes are handled on a best-effort basis. No response-time SLA is promised.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository when it is available. Do not put active credentials, exploit details, private repository content, or other sensitive material in a public issue. If private reporting is unavailable, open a minimal issue asking the maintainer to provide a private channel, without including the vulnerability details.

Include the affected RepoBound version or commit, operating system, Node version, a minimal reproduction, impact, and whether the issue can expose repository content or change local state. Response and remediation are best-effort for this early open-source project; no response-time SLA is promised.

## Security boundary

RepoBound reads local repositories with the permissions of the invoking user. Repository content, tasks, parser data, Git output, imported Capsules, and CLI/MCP/Studio inputs are untrusted. RepoBound does not execute repository source, provide shell or arbitrary-file MCP tools, upload repository data, or collect telemetry. Its sensitive-path and ignore policy cannot guarantee detection of every inline secret inside an otherwise eligible source file.

The explicit `studio` command starts an IPv4 loopback listener bound to one startup repository. Its per-process capability URL is a local credential: do not share it. API requests require that capability and the exact local origin; Host and Fetch Metadata checks reject foreign origins. Static assets use an allowlist and a restrictive content security policy. Request size, concurrency and ephemeral payload caching are bounded. This is a local single-user tool, not an authenticated multi-user service or a sandbox against another process with the same OS account.

History stores validated, compressed source-free Capsule metadata, never source payloads or original redacted task inputs. Recognized absolute paths are rejected in metadata. Studio withholds exact payloads containing recognized absolute paths; the explicit CLI context output retains its established source-output boundary. The lexical privacy policy is not a general secret detector. Logical deletion/pruning is not secure erasure. History rejects linked store paths and unsupported schemas, but cannot defend against a hostile OS account replacing ancestors or editing its database. See [the V0.3 product guide](docs/V0.3_PRODUCT_GUIDE.md) for limits and replay guarantees.

The SQLite WAL index is supported only on a local filesystem. Network and UNC filesystem placement is unsupported. See the README for the complete trust model and limitations.
