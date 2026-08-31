---
name: webq-gauntlet
description: Unified multi-AI orchestration engine combining webQ (multi-AI cross-reference) with Gauntlet Loop (build-vs-critique against concrete quality bars). Queries DeepSeek, ChatGPT, Claude, Gemini via Playwright + visible Chromium. The web AIs do ALL thinking across iterative rounds; the engine itself is a self-improving learning system that uses webQ recursively to verify and cross-reference its own accumulated knowledge.
---
# webQ-Gauntlet — Self-Improving Multi-AI Learning Engine

**The web AIs do ALL the thinking. The engine learns from every run and uses webQ recursively to verify its own knowledge.**

## Architecture

```
Round 1:   Question + Context → All AIs answer in parallel (independent)
Round 2:   All R1 answers → Each AI produces best combined solution (parallel)
Round 3..N: All previous answers → Each AI iterates, closing the single
            biggest gap against the quality bar (gauntlet loop)
Output:    results.md (human) + results.json (structured for learning engine)

Learning Loop:
  1. Completed run → Learning Engine (Redis Stack + vector DB)
  2. Next question → RAG retrieval from learning DB → enriched context
  3. If uncertain → webQ cross-reference run to verify/critique learned knowledge
  4. Synthesized answer → new GauntletRun → back to step 1
```

The engine is a **self-improving system**: every completed GauntletRun is ingested into the learning database. Future queries retrieve relevant past runs via vector similarity, enriching the context fed to web AIs. When confidence is low or contradictions arise, the engine spawns a verification webQ run to cross-reference its own learned knowledge against fresh AI reasoning.

## File Layout

```
webq-gauntlet/
├── SKILL.md                    # This file
├── context.md                  # Per-project context (auto-loaded, refresh per project)
├── engine/                     # Core scripts
│   ├── query.mjs              # Main engine (multi-round + gauntlet flags)
│   ├── launch.mjs             # One-time sign-in helper
│   ├── package.json           # Dependencies (playwright)
│   ├── results.md             # Appended run log (every round)
│   ├── results.json           # Structured output for local model (--json)
│   ├── answer-live.txt        # Live copy during runs
│   └── run-status.txt         # Last status line
├── assets/
│   └── progress-page.html     # Live progress page template
├── references/
│   ├── gauntlet-methodology.md    # Core methodology (roles, rules, workflow)
│   ├── bar-selection-guide.md     # Bar selection tables & examples
│   ├── prompt-templates.md        # Builder, critic, smoothing, lead prompts
│   └── origin-story.md            # Matt Shumer's "Claude of Duty" origin
└── agents/
    └── openai.yaml              # Agent config (if used)
```

## Setup

```bash
# 1. Install dependencies
cd webq-gauntlet/engine
npm install

# 2. Sign into AI services (one-time)
node launch.mjs
# Opens visible Chromium — sign into DeepSeek, ChatGPT, Claude, Gemini
# Close browser when done. Sessions persist in your real Chromium profile.
```

## Usage

### Basic Query (with auto-synthesis)
```bash
node engine/query.mjs "your question here"
```

### With Mode (structured output)
```bash
node engine/query.mjs --mode plan "Design a REST API for user management"
node engine/query.mjs --mode code "Write the auth middleware"
node engine/query.mjs --mode analyze "Should we use SSR or SPA?"
node engine/query.mjs --mode brainstorm "Explore authentication approaches"
node engine/query.mjs --mode debug "Error: Cannot read property 'map' of undefined"
```

### With JSON Output (for Learning Engine)
```bash
node engine/query.mjs --mode code --json "Write a user registration form"
# results.json structured for Learning Engine ingestion and RAG retrieval
```

### Auto-Detect Project Context
```bash
node engine/query.mjs --auto-context --mode plan "Add testing module"
```

### Skip Round 2 (independent answers only)
```bash
node engine/query.mjs --no-synthesis "Quick question"
```

### Gauntlet Mode (multi-round vs a quality bar)
```bash
# N rounds, each improving on all previous answers against a concrete bar
node engine/query.mjs --rounds 4 --bar "match this reference: <url / screenshot / paragraph / spec>" --mode plan "Goal"

# Resume/iterate: inject the single biggest gap from the latest critique
node engine/query.mjs --rounds 3 --bar "..." --critic-gap "<biggest remaining gap>" --mode code "Goal"
```
**The bar must be concrete and inspectable (a URL, a paragraph, a spec, a measurable property) — never an adjective like "amazing".**

## Project Context — refresh for EVERY project

`context.md` is a **per-project snapshot** (name, description, stack, key paths, recent work). It is NOT global and it is not supposed to persist: stale context from a previous project must never leak into a run.

- **New project → refresh it first:**
  ```bash
  cd <your-project>
  node webq-gauntlet/engine/query.mjs --write-context --no-save "seed context"
  # writes an auto-detected snapshot (package.json + README + top-level dirs) to context.md
  ```
  Or overwrite `context.md` by hand with the new project's snapshot.
- **Don't want the fallback at all:** `--no-context` (ignores context.md entirely).
- **Per-run context without touching the file:** `--auto-context`, `--context <file>`, or `--context-text "<str>"`.
- The default `context.md` is deliberately empty — treat any content there as the *current* project only.

## Modes

| Mode | Purpose | Output Format |
|------|---------|---------------|
| `plan` | Architecture/project planning | Numbered steps with deliverables |
| `code` | Code generation | Fenced code blocks with file paths |
| `analyze` | Architecture analysis | Trade-offs + recommendation |
| `brainstorm` | Open-ended exploration | Multiple approaches with pros/cons |
| `debug` | Error diagnosis | Root cause + fix |

## Flags

| Flag | Description |
|------|-------------|
| `--mode <mode>` | Thinking mode (plan/code/analyze/brainstorm/debug) |
| `--sites <list>` | Which AIs (default: deepseek,chatgpt,claude,gemini) |
| `--json` | Write results.json for local model consumption |
| `--auto-context` | Auto-detect project from working directory |
| `--context <file>` | Use specific context file |
| `--context-text "<str>"` | Inline context |
| `--profile <path>` | Explicit Chromium profile path |
| `--no-synthesis` | Skip improvement rounds (independent answers only) |
| `--rounds <n>` | Total rounds (default 2; 1 = independent only; 3+ = gauntlet) |
| `--bar "<text>"` | Concrete quality bar the output must beat (gauntlet) |
| `--critic-gap "<text>"` | Single biggest gap from the latest critique, injected into the next round |
| `--no-context` | Ignore the default context.md (opt out of the fallback) |
| `--write-context` | Snapshot this project into context.md (refresh for a new project) |
| `--model <name>` | DeepSeek model switch |
| `--keep-open` | Keep browser open after answering |
| `--login-timeout ` | Per-site login wait (default 120) |
| `--answer-timeout ` | Per-site answer wait (default 300) |
| `--no-save` | Don't write results files |
| `--debug` | Verbose logging |

## JSON Output Structure (for Learning Engine)

```json
{
  "timestamp": "2026-08-14T03:16:20.884Z",
  "mode": "code",
  "context": "## Project: myapp...",
  "question": "Write the auth middleware",
  "round1": [
    {"site": "DeepSeek", "response": "...", "error": null, "skipped": null},
    {"site": "ChatGPT", "response": "...", "error": null, "skipped": null}
  ],
  "round2": [
    {"site": "DeepSeek", "response": "best combined...", "error": null, "skipped": null},
    {"site": "ChatGPT", "response": "best combined...", "error": null, "skipped": null}
  ],
  "bar": "match this reference...",      // set when --bar given
  "round3": [...],                         // only when --rounds 3+
  "finalRound": 3,                         // last round number
  "final": [...]                           // always the last round's answers
}
```

The `results.json` output is structured for the **Learning Engine** — every completed run is ingested into Redis Stack + vector DB for RAG retrieval on future queries. The engine uses this accumulated knowledge to enrich context and, when uncertain, spawns verification webQ runs to cross-reference its own learning against fresh AI reasoning.

## Gauntlet Loop Rules (from Gauntlet Methodology)

1. **Lock the bar before Round 1.** The bar must be concrete and inspectable — never an adjective.
   - If the user gave a reference (URL, spec, paragraph, measurable property), use it as `--bar`.
   - If not, **propose one in one sentence** and confirm if ambiguous. A weak bar wastes every round.
2. **One gap per round.** The critique returns the *largest* meaningful gap, never a wishlist. Each improvement round closes exactly that gap.
3. **No fixed round cap.** Do not promise "3 rounds and done". Keep iterating until `final` beats the bar or the user stops.
4. **Escalate on stalls.** If the same gap recurs across 2–3 rounds, stop and ask the user — never silently lower the bar.
5. **Separation of critique.** The critique must come from a fresh look at the *real output* (the actual `final` answer in results.json), not from whoever produced it.
6. **Live progress log.** `engine/results.md` is the running log (the engine appends every round) — point the user at it.

## Running the Loop

### One-shot multi-round run (rounds 2..N in one browser session)
```bash
cd webq-gauntlet/engine
node query.mjs --rounds 4 --bar "match this reference: <url / paragraph / spec>" \
  --mode plan --json --auto-context "Goal"
```
Each round ≥2 shows every AI all previous answers plus the bar and asks for the best combined solution. One run, N rounds, single browser session.

### Iterative gauntlet (live loop, gap by gap)
```bash
# Round 1 + 2 baseline
node query.mjs --mode code --json --auto-context "Goal"

# Lead model reads engine/results.json `final`. If it misses the bar, name ONE biggest gap:
node query.mjs --rounds 2 --bar "..." --critic-gap "<single biggest gap>" \
  --mode code --json --auto-context "Goal"

# Repeat --critic-gap iterations until `final` beats the bar, or the user stops.
```

### Critic as a web AI (optional, strongest)
If you want the critique itself to come from a web AI rather than the local model, run a dedicated critic round first:
```bash
node query.mjs --rounds 1 --no-synthesis --mode analyze --json \
  "Act as a harsh critic. Here is the bar: <bar>. Here is the latest combined answer from engine/results.json 'final'. Return ONLY: verdict (bar_wins / output_wins / tie) and the SINGLE largest meaningful gap to close next. Do not return a wishlist. Do not propose a redesign."
```
Then feed the returned gap into the next improvement round with `--critic-gap`. The critic round uses a fresh chat and never sees the builders' reasoning — only the final text (matching the gauntlet's fresh-critic rule).

## Orchestration by the Local Model (the Lead)

1. Read `engine/results.json` after each run.
2. Compare the **`final`** (last round) answers against the bar. Judge the real text, not the prompt.
3. If it wins → implement `final` (the web AIs already cross-referenced; no local decisions needed).
4. If it loses → extract the single biggest gap, run another round with `--critic-gap`, repeat.
5. Escalate to the user if the same gap recurs 2–3 rounds.

## Troubleshooting

- **Not signed in**: Run `node engine/launch.mjs` first, sign into each AI, close browser.
- **Chromium not found**: Install Chromium or it falls back to Playwright's bundled browser.
- **Profile locked**: Close other Chromium windows, or the script auto-copies a login snapshot.
- **Site UI changed**: Update selectors in `TARGETS` at top of `engine/query.mjs`.
- **Claude logs out**: Never navigates to `claude.ai/auth`. Opens `claude.ai/new` directly.
- **Rounds take long**: each round re-queries every signed-in site (N × sites × answer time). Prefer `--rounds 3–4` over huge N, and use `--sites` to trim to the strongest AIs.

## Reference Files

See `references/` for:
- `gauntlet-methodology.md` — Core methodology: roles, hard rules, workflow, smoothing pass
- `bar-selection-guide.md` — Bar selection tables, worked examples, prompt templates
- `prompt-templates.md` — Builder, critic, smoothing, lead agent prompts
- `origin-story.md` — Matt Shumer's "Claude of Duty" origin, meta-prompt