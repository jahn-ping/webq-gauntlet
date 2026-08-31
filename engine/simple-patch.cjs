const fs = require('fs');
const file = 'query.mjs';
let content = fs.readFileSync(file, 'utf-8');

// 1. Add constants
const oldConst = "const CONTEXT_FILE = path.join(path.dirname(ROOT), 'context.md');";
const newConst = oldConst + "\nconst ROUND1_RESULTS_FILE = path.join(ROOT, 'round1-results.md');\nconst ROUND2_RESULTS_FILE = path.join(ROOT, 'round2-results.md');\nconst FINAL_RESULTS_FILE = path.join(ROOT, 'final-answer.md');";
content = content.replace(oldConst, newConst);

// 2. Find and replace archive section using line-by-line approach
const lines = content.split('\n');
let startIdx = -1, endIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('ARCHIVE ORIGINAL CONTEXT')) startIdx = i;
  if (startIdx > 0 && lines[i].includes("ctx = { text: newContextText, source:")) {
    endIdx = i;
    break;
  }
}

console.log(`Found archive section: lines ${startIdx+1} to ${endIdx+1}`);

// Build replacement code using string concatenation (no template literals)
const replacement = [
  '  // ---- SAVE ROUND 1 RESULTS (keep original context.md intact) ----',
  '  // Save R1 results to round1-results.md (per-source with headers)',
  '  const round1Context = round1',
  '    .filter((r) => !r.error && !r.skipped)',
  '    .map((r) => "## " + r.label + " (Round 1)\n\n" + r.response)',
  "    .join('\n\n---\n\n');",
  '  const round1Text = "# Round 1 Results \u2014 " + new Date().toISOString() + "\n\n" + round1Context;',
  "  writeFileSync(ROUND1_RESULTS_FILE, round1Text, 'utf-8');",
  '  console.log("[webQ] Round 1 results -> " + ROUND1_RESULTS_FILE + " (" + round1Text.length + " chars)");',
  '',
  '  // Build combined context for R2+ (original context + R1 results)',
  "  let combinedContext = '';",
  '  if (ctx.text) {',
  '    combinedContext += "## Original Context\n\n" + ctx.text + "\n\n---\n\n";',
  '  }',
  '  combinedContext += round1Text;',
  '  ',
  '  // Reload context for subsequent rounds (original + R1 results)',
  '  ctx = { text: combinedContext, source: "context.md + round1-results.md" };'
].join('\n');

if (startIdx > 0 && endIdx > 0) {
  lines.splice(startIdx, endIdx - startIdx + 1, replacement);
  content = lines.join('\n');
  console.log('Replaced archive section');
}

// 3. Add final synthesis before "// ---- Output ----"
const finalSynthesis = `
  // ---- SAVE ROUND 2 RESULTS ----
  if (rounds.length > 1) {
    const round2Context = rounds[1]
      .filter((r) => !r.error && !r.skipped)
      .map((r) => "## " + r.label + " (Round 2)\n\n" + r.response)
      .join('\n\n---\n\n');
    const round2Text = "# Round 2 Results \u2014 " + new Date().toISOString() + "\n\n" + round2Context;
    writeFileSync(ROUND2_RESULTS_FILE, round2Text, 'utf-8');
    console.log("[webQ] Round 2 results -> " + ROUND2_RESULTS_FILE + " (" + round2Text.length + " chars)");
  }

  // ---- FINAL SYNTHESIS ROUND ----
  console.log("\n[webQ] FINAL SYNTHESIS \u2014 Combining all results into definitive answer\u2026\n");
  
  const allR1Answers = rounds[0]
    .filter((r) => !r.error && !r.skipped)
    .map((r) => "### " + r.label + " (Round 1)\n\n" + r.response)
    .join('\n\n---\n\n');
  
  const allR2Answers = rounds.length > 1 
    ? rounds[1].filter((r) => !r.error && !r.skipped)
        .map((r) => "### " + r.label + " (Round 2)\n\n" + r.response)
        .join('\n\n---\n\n')
    : '';
  
  const finalPrompt = "You are the final synthesizer. Your job is to produce THE SINGLE BEST definitive answer to the question, combining the strongest elements from all previous rounds. Do not just summarize \u2014 produce the actual deliverable (code, plan, analysis) that represents the best of all answers combined.\n\n" +
    (args.mode && MODES[args.mode] ? MODES[args.mode].prefix : '') + "\n\n" +
    "## Original Project Context\n\n" +
    (ctx.text || 'No context provided.') + "\n\n" +
    "## Original Question\n\n" +
    args.query + "\n\n" +
    "## Round 1 Answers (Independent)\n\n" +
    allR1Answers + "\n\n" +
    "## Round 2 Answers (Cross-Referenced Improvement)\n\n" +
    (allR2Answers || 'No Round 2 answers available.') + "\n\n" +
    "## Your Task\n\n" +
    "Produce the SINGLE BEST definitive answer now. Take the strongest elements from Round 1 and Round 2, resolve any conflicts, and produce a complete, actionable result. This is the final answer that will be implemented.";

  const synthesisSite = sites[0];
  const synthesisTarget = TARGETS[synthesisSite];
  const finalArgs = Object.assign({}, args, { _roundTag: 'FINAL ', answerTimeoutSec: 600 });
  
  const finalResult = await pool.withContext(async (page, context, wrapper) => {
    return await querySite(page, context, synthesisSite, synthesisTarget, finalPrompt, finalArgs);
  });
  
  if (finalResult && !finalResult.error && !finalResult.skipped) {
    const finalContent = "# Final Answer \u2014 " + new Date().toISOString() + "\n\n## Question\n\n" + args.query + "\n\n## Synthesized Answer (" + finalResult.label + ")\n\n" + finalResult.response;
    writeFileSync(FINAL_RESULTS_FILE, finalContent, 'utf-8');
    console.log("[webQ] Final answer -> " + FINAL_RESULTS_FILE + " (" + finalResult.response.length + " chars)");
    rounds.push([{ label: "Final (" + finalResult.label + ")", response: finalResult.response }]);
  } else {
    console.log("[webQ] Final synthesis failed: " + (finalResult && finalResult.error ? finalResult.error : 'unknown error'));
  }
`;

content = content.replace('  // ---- Output ----', finalSynthesis + '\n  // ---- Output ----');

fs.writeFileSync(file, content, 'utf-8');
console.log('All patches applied successfully!');
