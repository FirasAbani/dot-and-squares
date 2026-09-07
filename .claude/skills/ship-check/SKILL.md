---
name: ship-check
description: Check whether the desktop app will show the current code, and get it there. Use after changing anything under src/, worker/, scripts/ or the pinned config — and whenever asked if the app/desktop/players are up to date, if something needs deploying or shipping, or why a change is not showing up in the game.
---

# Is the desktop app showing this build?

The desktop app opens the **deployed** site, never a local server
([scripts/launcher.sh](../../../scripts/launcher.sh)). So editing source changes
nothing a player sees. Two separate things can be behind, and they fail
differently:

| | Meaning | Symptom |
| --- | --- | --- |
| `dist/` behind source | The build is stale | **Silent.** The launcher's check compares `dist/` to live, so a stale `dist/` matching a stale site reports "up to date" and never offers Deploy Now |
| live behind `dist/` | Players are behind | The launcher offers **Deploy Now** on next launch |

The first is the dangerous one: it makes the desktop app's own guard lie. That
is what this skill exists to prevent.

## Run this

```
npm run build && npm run check-deployed
```

`build` typechecks both projects and rewrites `dist/`. `check-deployed` then
compares the content-hashed asset names in `dist/index.html` against what the
live page serves. Exit codes: **0** up to date, **1** players are behind,
**2** could not tell (offline, or no local build).

Capture the exit code — `npm run` swallows it in a pipe, so read
`${PIPESTATUS[0]}` or run it without a pipe.

## Then report, in one or two lines

- **Exit 0** — "Desktop app is current; nothing to deploy." Done. Do not deploy.
- **Exit 1** — Say players are on an older build, and that launching the desktop
  app will now offer **Deploy Now** (which is the user's normal route). Offer
  `npm run ship` as the alternative from here. **Do not deploy without asking** —
  deploying is outward-facing and the user drives it from the desktop icon.
- **Exit 2** — Say the check could not reach the site, and that `dist/` is now
  current either way. Never treat this as a failure to nag about.

If the asset hashes come back unchanged after the build, the edit did not reach
the bundle — a test-only or comment-only change. Say that in one line and stop.
That is a real, quiet answer, not a reason to invent work.

## What not to do

- **Do not `npm run deploy` on your own initiative.** Building is safe and local;
  deploying is a release.
- **Do not skip the build and only run `check-deployed`.** That reads a stale
  `dist/` and cheerfully reports "up to date" — the exact trap above.
- `dist/` is gitignored. There is nothing to commit here; do not stage it.
