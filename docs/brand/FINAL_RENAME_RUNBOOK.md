# Final RepoBound rename and release runbook

This runbook is for a separate, explicitly authorized final release. Stop at the
first failed safety, CI, registry or compatibility gate. Do not force-push,
rewrite history, move a tag, bypass review or publish a different artifact.

1. Lock the Draft PR number, exact head SHA and green final-head checks. Confirm
   the head is `chore/repobound-brand-migration`, base is `main`, and review has
   zero BLOCKING/IMPORTANT findings.
2. Merge only with explicit authorization and the locked head. If the merge
   command has an indeterminate network result, query PR state and merge commit,
   then fetch `origin/main` before any retry.
3. Check out/fetch the resulting exact `origin/main`; run the local release gates
   and wait for every post-merge main CI job. Record the immutable main SHA.
4. Rename the live repository only now:

   ```sh
   gh repo rename RepoBound --repo kallist/ContextForge --yes
   ```

5. Verify the old and new web URLs, `git ls-remote`, clone/fetch, Issues/PRs,
   Actions, raw links and repository redirects. Update the local `origin` to
   `https://github.com/kallist/RepoBound.git` only after the new endpoint works.
6. Run the Pages workflow from the exact main SHA. Verify
   `https://kallist.github.io/RepoBound/` and follow
   [PAGES_MIGRATION.md](PAGES_MIGRATION.md). Do not assume the old Pages path
   redirects.
7. Set the repository homepage to `https://kallist.github.io/RepoBound/` and the
   reviewed RepoBound description/topics; verify them through the GitHub API.
8. Reconfirm that local and remote `v0.5.1` are absent. Create an annotated tag
   on the exact green main commit, push only that tag, and verify the remote tag
   object and peeled commit.
9. Wait for all tag CI jobs. The tag must still peel to the locked main SHA.
10. From the exact tag checkout run `npm pack --json`; compare name, version,
    shasum, integrity, file count and sizes with the reviewed candidate. Publish
    only `@kallist/repobound@0.5.1` with public access.
11. Query the public registry for exact version/dist-tags/shasum/integrity. In a
    fresh directory and cache, install from the registry and run canonical and
    legacy CLI, official-client MCP, Studio, Review and state-compatibility smoke.
12. Validate the public Skill source and exact syntax:

    ```sh
    npx skills@1.5.26 add kallist/RepoBound --skill repobound --agent codex --copy --yes
    ```

    Record Codex discovery separately from Cursor/Claude copy-target checks and
    separately from any actually launched host runtime.
13. Create the GitHub Release `RepoBound v0.5.1` from the immutable tag with
    `docs/RELEASE_NOTES_V0.5.1.md` only after npm and fresh-install acceptance.
14. Only after the new public package and install are healthy, run the exact npm
    deprecation command in [MIGRATION_FROM_CONTEXTFORGE.md](MIGRATION_FROM_CONTEXTFORGE.md).
    Never unpublish or overwrite the historical package.
15. Upload `docs/assets/social-card.png` as the repository Social Preview through
    GitHub repository settings and verify the rendered 1200 × 630 image.
16. Recheck README English/Chinese, package metadata, public Skill, Pages and all
    external links. Confirm the old tags/releases remain untouched.
17. Stop before community promotion. Do not begin v0.6 in the release operation.
