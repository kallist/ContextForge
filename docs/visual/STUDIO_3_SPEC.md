# RepoBound Studio 3.0 Specification

## Outcome

Studio 3.0 makes one question unmistakable: **What should your agent see?** It keeps
the current loopback security model and lifecycle APIs and changes only presentation.

## Information architecture

1. Quiet header: RepoBound, repository/generation identity, amber `Indexed` state.
2. Primary composer: task first, 8,000-token budget, Build Context primary action.
3. Alternative mode: Current Git Change, visually secondary.
4. Result workbench: Context list on the left, Why inspector on the right.
5. Secondary views: Changes and History. Exact Context, Coverage, and Replay remain
   reachable from context/history inspection without dominating the first screen.

## Workbench behavior

- The Context column shows total selected/dropped counts and budget use, then ordered
  Selected and Dropped sections.
- Selecting any file updates Why without leaving the workbench.
- Why shows state, human-readable recorded decision, ranges/symbols/evidence, relevant
  structural relationships, and a link to Exact Context.
- Include/Prefer/Exclude appear in the selected item's inspector. Focus/Range are
  advanced actions. Controls create no source access and retain existing semantics.
- Rebuild is visible only when controls exist or the user enters the history workflow.
- Dropped means considered but not selected; copy must never say irrelevant.

## Empty state

“Build the repository context your agent should receive.” Include the example
“Fix the session race condition.” The task textarea remains the visual focal point.

## Accessibility and resilience

- Semantic buttons, labels, headings, live status, progress label, and focus order.
- Keyboard activation for every file row and contextual action.
- State labels accompany marker shapes and color.
- Long tasks and paths wrap. 1024px has no horizontal overflow.
- Existing hostile-input safety remains: dynamic text is written with `textContent`.

## Acceptance

- Real fixture screenshot passes at 1512×982, 1280×800, and 1024×768.
- Context and Why are understandable together in five seconds.
- No green and no AI-SaaS visual smell.
- Existing compile, Review, Explain, Coverage, controls, Diff, Replay, import, and
  history behavior remains available.
- No compiler, selection, packing, persistence, or MCP changes.

