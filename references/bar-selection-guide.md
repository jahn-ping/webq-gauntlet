# Bar Selection Guide

> How to pick a quality bar that is concrete, inspectable, and drives the gauntlet loop effectively.

---

## Bar Categories (pick one per piece)

### 1. Visual / Pixel Bar
**Use for:** UI, landing pages, dashboards, game visuals, anything rendered.
- **Format:** "Match this URL/screenshot: [URL or file path]"
- **Critic action:** Opens both side-by-side (or blind A/B) and judges pixels.
- **Examples:**
  - "Match Stripe's pricing page hero: https://stripe.com/pricing"
  - "Match this Figma frame: [Figma link]"
  - "Match the CoD killcam screenshot: [local path or URL]"

### 2. Structural / Code Bar
**Use for:** API design, SDK structure, database schema, config formats.
- **Format:** "Match the structure of [reference repo/file]: [URL]"
- **Critic action:** Compares file tree, exports, types, naming conventions.
- **Examples:**
  - "Match Express.js routing structure: https://github.com/expressjs/express/tree/master/examples"
  - "Match Stripe Node SDK client shape: https://github.com/stripe/stripe-node"
  - "Match Prisma schema conventions from this file: [path]"

### 3. Prose / Content Bar
**Use for:** Copy, docs, marketing, research summaries, emails.
- **Format:** "Beat these specific paragraphs in blind ranking: [paragraph A], [paragraph B], [paragraph C]"
- **Critic action:** Blind A/B/C ranking by a fresh reader.
- **Rules:** Must cite EXACT paragraphs (not "competitor's homepage").
- **Examples:**
  - "Beat these 3 SaaS hero headlines in blind test: [para1], [para2], [para3]"
  - "Match the clarity of Stripe's API reference intro paragraph: [exact quote]"

### 4. Measurable Property Bar
**Use for:** Performance, bundle size, test coverage, latency, token usage.
- **Format:** "<metric> <operator> <threshold> on <workload>"
- **Critic action:** Runs benchmark / measures artifact.
- **Examples:**
  - "p99 latency < 50ms on 1k RPS load test (script: bench/load.js)"
  - "Bundle size < 50KB gzipped (webpack-bundle-analyzer)"
  - "Test coverage > 90% on critical paths (jest --coverage)"
  - "Token count < 2000 for this prompt (tiktoken)"

### 5. Methodology / Process Bar
**Use for:** Research, analysis, reviews, audits.
- **Format:** "Follow the methodology of [paper/standard] section [X]"
- **Critic action:** Checks steps against reference methodology.
- **Examples:**
  - "Follow OWASP ASVS 4.0 Level 1 checklist for auth review"
  - "Follow the experimental design of [paper] Section 3.2"
  - "Follow SemVer decision tree from semver.org"

---

## Worked Examples

### Example 1: Landing Page
```
Goal: "Build a SaaS landing page for a dev tool"
Bad bar: "Make it look professional"
Good bar: "Match linear.app hero + feature grid + footer exactly (URLs provided). Critic opens both blind."
```

### Example 2: REST API Design
```
Goal: "Design a payments API"
Bad bar: "Clean REST API"
Good bar: "Match Stripe's API resource hierarchy + error format + idempotency keys (https://stripe.com/docs/api). Critic compares OpenAPI spec."
```

### Example 3: Marketing Copy
```
Goal: "Write hero headline for dev tool"
Bad bar: "Punchy and compelling"
Good bar: "Beat these 3 headlines in blind ranking:
  A. 'Build faster. Ship confidently.'
  B. 'The API platform developers love.'
  C. 'Ship 10x faster with type-safe APIs.'
Critic: fresh chat, blind A/B/C, returns winner + why."
```

### Example 4: Performance Optimization
```
Goal: "Optimize this React component"
Bad bar: "Make it fast"
Good bar: "p99 render < 16ms on 10k item list (benchmark: bench/render.js). Current: 45ms."
```

### Example 5: Research Report
```
Goal: "Analyze competitor pricing strategies"
Bad bar: "Thorough analysis"
Good bar: "Follow McKinsey 3-horizon framework (Horizon 1/2/3 structure). Critic checks section presence + evidence citations."
```

---

## Bar Selection Checklist

Before starting a gauntlet run, verify:

- [ ] **One bar per piece** (split multi-axis goals into separate pieces)
- [ ] **Concrete reference exists** (URL, file, paragraph, metric, methodology)
- [ ] **Inspectable by a fresh critic** (no hidden context needed)
- [ ] **Single sentence to state** (if you can't state it in one sentence, it's not a bar)
- [ ] **No adjectives** ("good", "clean", "premium", "robust", "scalable" → reject)

---

## Prompt Templates for Bar Declaration

### In the gauntlet prompt (`--bar`):
```
QUALITY BAR (the output must beat this reference):
Match linear.app hero section exactly: https://linear.app
Critic will open both side-by-side and judge pixels, spacing, typography, copy.
```

### For the critic round:
```
Act as a harsh critic. Here is the bar:
[bar text]

Here is the latest combined answer:
[final answer from results.json]

Return ONLY:
verdict: bar_wins | output_wins | tie
gap: <single largest meaningful gap — one sentence>
```

---

## Anti-Patterns to Avoid

| Anti-pattern | Why it fails | Fix |
|--------------|--------------|-----|
| "Make it good" | Not inspectable | Pick a reference URL |
| "Follow best practices" | Whose? Which? | Cite a specific doc/repo |
| "Production ready" | Means nothing | Define: tests, types, errors, observability |
| "Industry standard" | Vague | Name the standard (RFC, spec, repo) |
| Multiple bars in one | Confuses critic | Split into separate pieces |