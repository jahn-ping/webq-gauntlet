# Gauntlet Methodology

> **Origin**: Matt Shumer's "Claude of Duty" (May 2025) — a prompt that made Claude 4 play *Call of Duty* by screenshotting the game, reasoning about state, and issuing mouse/keyboard commands in a loop. The core insight: **never let the builder grade itself**. Split into Builder (proposes) + Critic (judges against a concrete bar) + Lead (orchestrates).

---

## Core Principle

**Never let the builder grade itself.**

| Role | Responsibility | Context |
|------|---------------|---------|
| **Lead** (local model) | Orchestrates, holds goal+bar, decomposes, fans out, maintains progress page | Full |
| **Builder** (web AI) | Produces/modifies one piece | Goal, bar, previous gap note only |
| **Critic** (web AI or local) | Inspects REAL output vs bar, returns ONE biggest gap | Fresh — ONLY sees output + bar |

---

## 6 Hard Rules

1. **Separation of context** — Builder & critic are separate Agent calls (or separate web AI chats).
2. **Inspect real output** — Critics compare actual rendered pixels/code/text, not the builder's reasoning.
3. **One gap per round** — Largest meaningful gap only, not a wishlist.
4. **No self-grading** — Only a fresh critic's "output wins" closes a piece.
5. **No fixed round count** — Loop until bar beaten or human stops.
6. **Stay in scope** — Builders touch only their piece.

---

## Workflow

```
1. User gives goal (e.g. "Build a landing page")
2. Lead proposes a CONCRETE BAR (URL, screenshot, spec, measurable property)
   - If user didn't give one, Lead proposes in ONE sentence and confirms
3. Round 1: Builders produce independent attempts (parallel)
4. Round 2: Each builder sees ALL previous attempts + bar → produces best combined
5. Critic (fresh chat) inspects REAL output vs bar → returns ONE biggest gap
6. If gap exists: Round N+1 — builders get gap note + all history → improve
7. Repeat until bar beaten or user stops
8. Smoothing pass (optional): single pass to merge style/imports/dead code
```

---

## Quality Bar Requirements

**Must be concrete and inspectable — never an adjective.**

| ❌ Bad Bar | ✅ Good Bar |
|------------|-------------|
| "AAA quality" | "Match this CoD screenshot: [URL]; critic opens both blind" |
| "Looks premium" | "Match linear.app hero section exactly" |
| "Punchy copy" | "Beat these 3 competitor paragraphs in blind ranking" |
| "Clean API" | "Match Stripe's SDK structure: [repo URL]" |
| "Fast" | "p99 < 50ms on this benchmark workload" |
| "Rigorous" | "Follow methodology of [paper section]" |

**Rules:**
- Prefer pixels/running behavior over prose
- Prefer measurable properties (latency, token count, pass rate)
- If prose bar: cite exact paragraphs
- One bar per piece; split multi-axis goals

---

## Critique Protocol

**Input to critic:** Only the final output text + the bar. Never the builder's reasoning.

**Output from critic (exactly):**
```
verdict: bar_wins | output_wins | tie
gap: <single largest meaningful gap — one sentence, actionable>
```

No wishlists. No redesigns. No "also consider". One gap.

---

## Smoothing Pass (Optional)

After bar is beaten, one final pass by a single builder:
- Merge imports, unify style, remove dead code, fix nits
- Does NOT re-architect or add features
- Input: all final pieces + bar (for reference only)

---

## Escalation

If the same gap recurs 2–3 rounds → **stop and ask the user**. Never silently lower the bar.

---

## Integration with webQ-Gauntlet

The webQ engine implements Rounds 1..N in one browser session:
- Round 1: Independent answers (parallel)
- Rounds 2..N: Each AI sees ALL previous rounds + bar + critic gap → best combined
- `--critic-gap` injects the Lead's (or web AI critic's) single biggest gap
- `results.json` `final` = last round's answers (what the local model implements)