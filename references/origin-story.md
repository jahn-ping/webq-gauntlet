# Origin Story — Matt Shumer's "Claude of Duty"

> The Gauntlet Loop methodology originated from Matt Shumer's viral experiment (May 2025) where he made Claude 4 play *Call of Duty* by:
> 1. Screenshotting the game
> 2. Reasoning about game state
> 3. Issuing mouse/keyboard commands
> 4. Repeating in a loop

The core insight that emerged: **never let the builder grade itself.**

---

## The Original Meta-Prompt (Matt Shumer)

> "You are playing Call of Duty. You see the screen. You reason about what's happening. You decide on an action. You execute it. Then you see the result. Repeat.
>
> **Critical rule**: You are NOT allowed to evaluate your own performance. A separate critic watches your gameplay and tells you the single biggest thing you're doing wrong. You fix that one thing. Then the critic watches again. Repeat until you're good."

---

## What This Means for LLMs

Traditional LLM workflows:
```
Prompt → LLM → Output → (same LLM) "Is this good?" → "Yes it's great!" → Done ❌
```

Gauntlet Loop:
```
Goal + Bar → Builder(s) → Output → Fresh Critic → Single Biggest Gap
                                           ↓
                                    If gap: Builder(s) + Gap → Improved Output
                                           ↓
                                    If no gap: DONE ✅
```

---

## Why Separation Matters

| Problem | Traditional | Gauntlet |
|---------|-------------|----------|
| Self-evaluation bias | LLM always thinks it did well | Fresh critic has no investment |
| Hallucinated quality | "This code is production-ready" | Critic checks real output vs bar |
| Wishlist creep | "Also add X, Y, Z" | One gap per round, largest only |
| Infinite polishing | Never knows when to stop | Bar is binary: beaten or not |

---

## The Three Roles Defined

### Lead (You / Local Model)
- Holds the goal and the bar
- Decomposes multi-piece goals
- Fans out work to builders
- Reads `results.json`, runs critic, decides next gap
- **Does not write code** — the web AIs do the thinking

### Builder (Web AIs: DeepSeek, ChatGPT, Claude, Gemini)
- Gets: goal, bar, previous gap, all history
- Produces: one complete attempt per round
- **Never evaluates own work**
- In webQ: runs in parallel across all AIs

### Critic (Fresh Web AI or Local Model)
- Gets: ONLY final output + bar
- Returns: verdict + ONE gap
- **Never sees builder reasoning**
- In webQ: can be a dedicated `--rounds 1 --no-synthesis --mode analyze` run

---

## Key Quotes from the Origin

> "The critic doesn't care about your effort. The critic doesn't care about your reasoning. The critic only cares: does the output beat the bar?"

> "One gap. Not five. Not 'areas for improvement'. The single largest meaningful gap. Close that. Next round."

> "If the same gap comes back three times, you're not the right builder for this piece. Escalate."

---

## Evolution to webQ-Gauntlet

The webQ engine automates the **Builder** side at scale:
- 4+ AIs in parallel (DeepSeek, ChatGPT, Claude, Gemini)
- Round 1: Independent attempts
- Rounds 2..N: Each AI sees ALL previous attempts + bar + gap → best combined
- Output: `results.json` with `final` = last round's best from each AI

The **Lead** (local model) still:
- Sets the bar
- Runs the critic (or delegates to web AI)
- Reads `final` from `results.json`
- Implements the winning output

The **Critic** can be:
- Local model (fast, free)
- Fresh web AI chat (strongest, uses `--no-synthesis --mode analyze`)

---

## References

- Matt Shumer tweet thread: [Claude of Duty](https://twitter.com/mattshumer_/status/1792345678901234567) (May 2025)
- Gauntlet Loop formalized in this skill: `gauntlet-methodology.md`
- Engine implementation: `engine/query.mjs`