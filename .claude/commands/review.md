---
description: Send the working diff to the specialist review panel (rules, infra, security, UI, UX, duplication)
argument-hint: "[agent names to force] · [a diff range like main...HEAD] · or `all` to review the whole repo"
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(npm test:*), Bash(npx tsc:*), Read, Grep, Glob, Agent
---

Invoking this command **is** the user's request to use the Agent tool. Spawn the panel.

## 1. Decide what is being reviewed

```bash
git status --porcelain && git diff --stat HEAD && git log --oneline -5
```

Default to the uncommitted working tree plus anything on this branch that is not on `main`.

- If `$ARGUMENTS` contains a range (`main...HEAD`, a SHA, `HEAD~3`), use that.
- If `$ARGUMENTS` is `all`, skip the diff entirely and review the repository as it
  stands — the right mode just after an initial commit, or for a periodic audit.
- If the tree is clean, the branch matches `main`, and no range or `all` was given,
  say so and stop. There is nothing to review.

For a diff review, get real content with `git diff -U10 HEAD`. Keep it bounded: if the
diff is large, send `--stat` plus the diffs that matter and tell each agent to read the
rest from disk.

## 2. Pick the panel

Spawn only the reviewers whose domain the change actually touches. Paying six agents to
report "no rules changes here" is the failure mode this routing exists to prevent.

| Agent | Spawn when the change touches |
|---|---|
| `game-rules-reviewer` | anything in `src/shared/games/` — a reducer or its tests |
| `infra-reviewer` | `src/server/`, `src/worker/`, `src/shared/room.ts`, `protocol.ts`, `types.ts`, `wrangler.toml`, `capacitor.config.ts`, `vite.config.ts`, `android/` |
| `security-reviewer` | the protocol, either adapter, anything touching `playerId`/`seat`/`rng`, dependencies — and always before a deploy |
| `ui-reviewer` | `src/client/styles.css`, `palette.ts`, any board component, `index.html`, `scripts/*.mjs` |
| `ux-reviewer` | `src/client/App.tsx`, `net.ts`, any board component, any user-facing string |
| `dry-reviewer` | a new game, a new board component, or any change landing in **both** adapters |

For `all`, spawn all six.

If `$ARGUMENTS` names agents explicitly, spawn exactly those and skip the routing.

## 3. Spawn them in parallel

All Agent calls go in **one** message — they are independent, and serial spawning wastes
minutes. Run them in the background and collate as they land.

Each agent starts cold and knows nothing about this session. Every prompt must carry:

- the diff, or the file list plus what to read;
- one line on what the change was *trying* to do — intent, not justification;
- the branch or range so it can re-derive anything it needs;
- an explicit instruction to report nothing if it finds nothing.

Do **not** tell an agent what you think of the change, defend a decision, or pre-empt a
finding. If the panel is reviewing work from earlier in this session, that is exactly the
bias worth avoiding — give them the change and the intent, and let them reach their own
conclusions.

## 4. Collate

One merged report, grouped by severity rather than by agent, with the agent named on each
finding so the source can be weighed:

```
BLOCKER
  [game-rules-reviewer] <claim>  — <file:line>
      <why, one or two lines>  → <fix>

SHOULD FIX
  ...

NOTE
  ...
```

Then, in two or three lines:

- **Where reviewers disagree**, say so and give your own read. Do not average them.
- **Flag anything you believe is wrong.** These agents are cold and can be confidently
  mistaken — a `BLOCKER` resting on a misread of the hibernation path, or on a file the
  agent never opened, is worth contradicting. Verify a surprising finding before relaying it.
- Some findings are **known and accepted**: there is no rate limiting, and the palette is
  duplicated between `styles.css` and `scripts/png.mjs` because those two cannot import
  each other. Say so rather than presenting them as news.
- If the panel came back clean, say that in one line. Do not manufacture concerns.

**Do not start fixing anything.** The panel reports; Amelia decides what gets acted on.
Wait to be told, then apply the accepted findings.
