# Migrating from ContextForge to RepoBound

RepoBound v0.5.1 is the renamed continuation of ContextForge. It is not a new
compiler, ranking system, Pack format or database generation.

| Old | New |
|---|---|
| ContextForge | RepoBound |
| `kallist/ContextForge` | `kallist/RepoBound` |
| `@kallist/contextforge` | `@kallist/repobound` |
| `contextforge` | `repobound` |
| `contextforge` Skill | `repobound` Skill |
| `/ContextForge/` Pages path | `/RepoBound/` Pages path |

## Compatibility in v0.5.1

- `contextforge` remains a silent executable alias for `repobound` and runs the
  same application entrypoint. It does not print deprecation warnings into JSON,
  stdio or shell pipelines.
- Existing `.contextforge/index.sqlite` and `.contextforge/history` state remains
  the canonical on-disk state. RepoBound does not create a parallel state root or
  perform a schema migration.
- Existing ContextForge Capsules remain valid. Stable `contextforge-*` schema,
  strategy, estimator, dataset and benchmark identifiers remain intentional.
- The historical `@kallist/contextforge` package and all old releases/tags remain
  available. They are not overwritten or unpublished.
- The old npm package is not deprecated during candidate implementation. After
  `@kallist/repobound@0.5.1` is public and a fresh registry install passes, the
  final release operator may run:

```sh
npm deprecate "@kallist/contextforge@*" "ContextForge has been renamed to RepoBound. Install @kallist/repobound instead."
```

Already-installed ContextForge Skills are not removed from user machines. Install
the `repobound` Skill after the GitHub rename, then remove the old copy manually
if the host would otherwise discover both.
