const ROUND1_REPLACEMENT = [
  '  // ---- SAVE ROUND 1 RESULTS (keep original context.md intact) ----',
  '  // Save R1 results to round1-results.md (per-source with headers)',
  '  const round1Context = round1',
  '    .filter((r) => !r.error && !r.skipped)',
  '    .map((r) => )',
  "    .join('

---

');",
  '  const round1Text = ;',
  "  writeFileSync(ROUND1_RESULTS_FILE, round1Text, 'utf-8');",
  '  console.log(`[webQ] Round 1 results -> ${ROUND1_RESULTS_FILE} (${round1Text.length} chars)`);',
  '',
  '  // Build combined context for R2+ (original context + R1 results)',
  "  let combinedContext = '';",
  '  if (ctx.text) {',
  '    combinedContext += `## Original Context

${ctx.text}

---

`;',
  '  }',
  '  combinedContext += round1Text;',
  '  ',
  '  // Reload context for subsequent rounds (original + R1 results)',
  '  ctx = { text: combinedContext, source: `context.md + round1-results.md` };'
].join('
');

const FINAL_SYNTHESIS = [
  '',
  '  // ---- SAVE ROUND 2 RESULTS ----',
  '  if (rounds.length > 1) {',
  '    const round2Context = rounds[1]',
  '      .filter((r) => !r.error && !r.skipped)',
  '      .map((r) => `## ${r.label} (Round 2)

${r.response}`)',
  "      .join('

---

');",
  '    const round2Text = `# Round 2 Results — ${new Date().toISOString()}

${round2Context}`;',
  "    writeFileSync(ROUND2_RESULTS_FILE, round2Text, 'utf-8');",
  '    console.log(`[webQ] Round 2 results -> ${ROUND2_RESULTS_FILE} (${round2Text.length} chars)`);',
  '  }',
  '',
  '  // ---- FINAL SYNTHESIS ROUND ----',
  '  console.log(`
[webQ] FINAL SYNTHESIS — Combining all results into definitive answer…
`);',
  '  ',
  '  const allR1Answers = rounds[0]',
  '    .filter((r) => !r.error && !r.skipped)',
  '    .map((r) => `### ${r.label} (Round 1)

${r.response}`)',
  "    .join('

---

');",
  '  ',
  '  const allR2Answers = rounds.length > 1 ',
  '    ? rounds[1].filter((r) => !r.error && !r.skipped)',
  '        .map((r) => `### ${r.label} (Round 2)

${r.response}`)',
  "        .join('

---

')",
  '    : "";',
  '  ',
  '  const finalPrompt = `You are the final synthesizer. Your job is to produce THE SINGLE BEST definitive answer to the question, combining the strongest elements from all previous rounds. Do not just summarize — produce the actual deliverable (code, plan, analysis) that represents the best of all answers combined.',
  '',
  '${args.mode && MODES[args.mode] ? MODES[args.mode].prefix : ""}',
  '',
  '## Original Project Context',
  '',
  '${ctx.text || 'No context provided.'}',
  '',
  '## Original Question',
  '',
  '${args.query}',
  '',
  '## Round 1 Answers (Independent)',
  '',
  '${allR1Answers}',
  '',
  '## Round 2 Answers (Cross-Referenced Improvement)',
  '',
  '${allR2Answers || 'No Round 2 answers available.'}',
  '',
  '## Your Task',
  '',
  'Produce the SINGLE BEST definitive answer now. Take the strongest elements from Round 1 and Round 2, resolve any conflicts, and produce a complete, actionable result. This is the final answer that will be implemented.`;',
  '',
  '  const synthesisSite = sites[0];',
  '  const synthesisTarget = TARGETS[synthesisSite];',
  '  const finalArgs = Object.assign({}, args, { _roundTag: 'FINAL ' , answerTimeoutSec: 600 });',
  '  ',
  '  const finalResult = await pool.withContext(async (page, context, wrapper) => {',
  '    return await querySite(page, context, synthesisSite, synthesisTarget, finalPrompt, finalArgs);',
  '  });',
  '  ',
  '  if (finalResult && !finalResult.error && !finalResult.skipped) {',
  '    const finalContent = `# Final Answer — ${new Date().toISOString()}

## Question

${args.query}

## Synthesized Answer (${finalResult.label})

${finalResult.response}`;',
  "    writeFileSync(FINAL_RESULTS_FILE, finalContent, 'utf-8');",
  '    console.log(`[webQ] Final answer -> ${FINAL_RESULTS_FILE} (${finalResult.response.length} chars)`);',
  '    rounds.push([{ label: `Final (${finalResult.label})`, response: finalResult.response }]);',
  '  } else {',
  '    console.log(`[webQ] Final synthesis failed: ${finalResult && finalResult.error ? finalResult.error : 'unknown error'}`);',
  '  }',
  '].join('
');',
  '',
  'module.exports = { ROUND1_REPLACEMENT, FINAL_SYNTHESIS };',
