# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `gvibco/mesto-realty`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — the five canonical labels as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root + `docs/adr/`. See `docs/agents/domain.md`.

## Quality workflow

Every update follows the same loop:

1. **Before push:** `npm run preflight` (unit tests, formatting, dependency audit, junk check). The `.githooks/pre-push` hook runs it automatically; `npm run setup` enables it with `git config core.hooksPath .githooks`.
2. **Push and deploy:** `git push origin main`. Dockhost rebuilds the `techeco` repository automatically on new commits; if the live site does not change within a few minutes, run `dockhost repository build techeco`.
3. **After deploy:** `npm run verify:live` (health, content, assets, assistant plausibility).
4. **Review:** invoke the `quality-reviewer` subagent (`.opencode/agent/quality-reviewer.md`). It audits the change for dead code, duplication, compactness and AI plausibility (site assistant answers and AI-authored edits) and reports `BLOCKER/IMPROVEMENT/NIT` findings without editing anything.
