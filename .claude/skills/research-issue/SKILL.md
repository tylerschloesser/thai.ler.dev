---
name: research-issue
description: Research a task or project and file a detailed, self-contained GitHub issue that a separate Claude session (claude.ai/code, or an @claude comment via the GitHub Action) can execute without the author present. Invoke as /research-issue <topic or question>.
argument-hint: [topic or question]
disable-model-invocation: true
allowed-tools: Bash(gh issue *) Bash(gh search *) Bash(gh label *)
---

# Turn a topic into an executable issue

Topic: $ARGUMENTS

The output is one GitHub issue that a session with no memory of this conversation can pick
up and finish. Everything the executor would otherwise have to ask goes in the issue.

## 1. Frame

Restate the topic as a goal and a non-goal, two sentences. If the topic is ambiguous in a
way that would change the spec materially, ask the user once now; this skill runs in the
user's own session, so a question is fine. Otherwise state your assumption in the issue.

## 2. Research, delegating what you can

Follow `CLAUDE.md` "How to work": the expensive model decides, cheaper models look.

- Send codebase reconnaissance to `Explore` subagents (`model: sonnet`), one specific
  question each ("where is X wired", "what calls Y", "which files would a change to Z touch").
  Ask for `file:line` answers, not summaries.
- Read yourself: the `.claude/rules/*.md` files for every area the work touches (they hold
  the invariants the spec must respect), `README.md` for the why, and
  `gh issue list --state all --limit 50` for related or superseding work.
- When the topic involves a library or service, check its current docs on the web rather
  than memory. The Base UI rule in `.claude/rules/web-ui.md` is the precedent for why.

Stop researching when you can write every section below without a placeholder.

## 3. Decide

Pick one approach and say why the alternatives lost. A spec with a menu is not executable.
If a decision genuinely needs the user, make it an open question with a default.

## 4. Write the spec

Write the body to a file in the session scratchpad (or `/tmp`). Every heading present;
"none" is a valid entry.

```markdown
## Why
The problem or opportunity in one paragraph, with links to anything that motivated it.

## Outcome
Acceptance criteria as observable checks. Each one names the command, grep, or browser
step that proves it.

## Where
Entry points as `path/to/file.ts` plus the function or export. The rule files to read
before starting. Existing patterns in the codebase to copy.

## Approach
The chosen design in enough detail to start typing. Alternatives considered and why they
lost.

## Chunks
Ordered steps sized for the implementer/verifier pattern in CLAUDE.md. Each chunk carries
its own one-line acceptance check.

## Constraints and gotchas
Invariants from the rule files this work touches. That `pnpm dev` and the preview server
hit production data. That there is no test framework, so the browser checks in
`verify-offline` (or a named `playwright-cli` walk) are the tests.

## Out of scope
Explicit, so the executor does not drift.

## Verification
The exact commands and browser walk that close the issue.

## Open questions
Decisions left to the executor, each with the default to take if nobody answers.

---
Filed by Claude Code on <date> from /research-issue.
Session: <the Claude-Session link you were given, else `${CLAUDE_SESSION_ID}`>.
Related: <issue numbers, or none>.
```

Rules: point at code by `file:line`; quote real output where there is any; **never write
`@claude` in the title or body**, because the GitHub Action starts a run the moment an
issue containing that phrase is opened.

## 5. Dedupe and file

Search before creating, as in `.claude/skills/file-issue/SKILL.md` step 2:

```bash
gh issue list --state all --limit 30 --search "<three to five distinctive words>"
```

If an open issue already covers the topic, update it instead:
`gh issue edit <n> --body-file <file>` when it is Claude's own earlier spec, or
`gh issue comment <n> --body-file <file>` when a person wrote it. Otherwise:

```bash
gh issue create --title "<imperative title>" --body-file <file> --label claude --label enhancement
```

Use `bug` instead of `enhancement` when the research was about a defect. If a label is
rejected, `gh label create claude --description "Filed by Claude Code" --color 6f42c1`
and retry.

## 6. Report

Give the user the URL, a five-line summary of the approach, and the two ways to hand it
off: comment `@claude implement this issue` on it for the GitHub Action, or open
claude.ai/code on this repo and point the session at the issue. If they want changes, edit
in place with `gh issue edit <n> --body-file`.
