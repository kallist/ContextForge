# RepoBound Agent Skill

The canonical Skill is [`repobound`](../repobound/SKILL.md). It guides a coding
agent through three workflows: compiling task context, reviewing tracked Git
changes through the CLI, and debugging recorded selection decisions.

After the GitHub repository rename, the public install command is:

```sh
npx skills@1.5.26 add kallist/RepoBound --skill repobound --agent codex --copy --yes
```

For release-candidate validation before the live rename, use the exact reviewed
checkout or commit as the installer source. Do not present that candidate check
as a successful public GitHub installation.

The Skill does not install RepoBound, mutate host configuration or add MCP tools.
It first uses an existing healthy MCP connection with the exact tool set
`status`, `index`, `search`, `pack`; otherwise it checks the installed
`repobound` CLI. Review remains a CLI workflow because there is no Review MCP
tool. Cursor and Claude Code copy-target validation does not prove their host
runtimes or model execution were tested.

Existing user-installed `contextforge` Skills are not removed automatically.
Users should install `repobound` and remove the old Skill themselves if their
host would discover both copies.
