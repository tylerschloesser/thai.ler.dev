---
name: file-issue
description: File a GitHub issue for a problem you found that is outside the current task, after checking it is not already tracked. Use when you notice a bug, a stale claim in the docs or rules, a missing check, or debt that the current change should not absorb; also when the user says "file an issue" or "track this". The issue is a hand-off to a session with no memory of this conversation, so it must stand alone.
allowed-tools: Bash(gh issue *) Bash(gh search *) Bash(gh label *)
---

# File a side finding as a GitHub issue

A problem the current task does not cover is neither fixed nor dropped. It becomes an issue,
its URL goes in your report, and you carry on. Budget: two to four `gh` calls.

## 1. Decide it is a side finding

Ask one question: would fixing it widen the diff beyond what was asked? If yes, file it. If
the current task will fix it anyway, don't. If you are not sure it is real, say so in the
issue rather than skipping it; a hypothesis with evidence is still worth tracking.

## 2. Check it is not already tracked

Search twice, once on the symptom and once on the code it touches:

```bash
gh issue list --state all --limit 30 --search "<three to five distinctive words>"
gh issue list --state all --limit 30 --search "<file or symbol name>"
```

Read the titles. For any candidate, `gh issue view <n>` before deciding.

- **Open match:** do not file. If you have evidence the issue lacks (a reproduction, a
  cause, a file:line), add it with `gh issue comment <n> --body-file <file>`. Otherwise just
  link it in your report.
- **Closed match:** file a new issue and cite the old one as a possible regression.
- **No match:** file.

## 3. Write the body, then create

Write the body to a file in the session scratchpad (or `/tmp`), then:

```bash
gh issue create --title "<title>" --body-file <file> --label claude --label <bug|enhancement|documentation>
```

Title: the symptom or the change, specific, under about 70 characters. Body, every heading
present ("none" is a valid entry):

```markdown
## What happens
Observed versus expected, with the real output, error text, or request line.

## How to reproduce
Exact steps or command. In this repo that is often a `verify-offline` check by number,
or a `playwright-cli` walk.

## Where
`path/to/file.ts:line` for each place involved, and the `.claude/rules/*.md` file that
governs it.

## Likely cause
Marked as a hypothesis unless you proved it. Say what you ruled out.

## Suggested direction
One paragraph, optional. Name the option to verify against the installed version.

## How to verify a fix
The command or browser walk that would close this issue.

## Out of scope
What this issue deliberately does not cover.

---
Filed by Claude Code on <date> while working on <one clause about the task>.
Session: <the Claude-Session link you were given, else `${CLAUDE_SESSION_ID}`>.
```

Rules for the body:

- **Never write `@claude` in a title or body.** The GitHub Action starts a run the moment an
  issue containing that phrase is opened. A person adds it as a comment when they want one.
- Point at code by `file:line`; a reader in another session has no diff in front of them.
- Quote real output. "It fails" is not a symptom; the error line is.
- Prefer one issue per finding. Two unrelated findings are two issues.

If `gh issue create` rejects a label, create it and retry:

```bash
gh label create claude --description "Filed by Claude Code" --color 6f42c1
```

## 4. Report and resume

Put the issue URL (or the existing issue you found) in your final message, one line, then
return to the task. Do not fix the finding unless the user asks.
