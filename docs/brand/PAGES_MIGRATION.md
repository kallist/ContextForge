# GitHub Pages migration

| Surface | Address |
|---|---|
| Current historical site | `https://kallist.github.io/ContextForge/` |
| Target RepoBound site | `https://kallist.github.io/RepoBound/` |

The candidate site uses relative runtime asset links and declares the future
RepoBound project-site URL in canonical and Open Graph metadata. The Pages
workflow builds on pull requests and deploys only on a push to `main`; this
candidate task does not deploy production Pages.

## Final-release verification

1. After the reviewed PR is merged and the repository is renamed, confirm the
   Pages `build` job consumes that exact main commit.
2. Confirm the `deploy` job runs only for the main push and succeeds.
3. Open `/RepoBound/` with a fresh browser profile; verify HTML, CSS, every image,
   canonical metadata and same-origin-only runtime requests.
4. Verify README and repository homepage links point at `/RepoBound/`.
5. Check the old `/ContextForge/` address independently and record its actual
   behavior rather than assuming a repository redirect covers Pages.

GitHub project-site renames do not guarantee that the old Pages path redirects.
An optional future redirect repository or other redirect mechanism needs separate
approval; none is created by v0.5.1.
