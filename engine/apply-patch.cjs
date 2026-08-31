const fs = require('fs');
const { ROUND1_REPLACEMENT, FINAL_SYNTHESIS } = require('./patch-code.cjs');

const file = 'query.mjs';
let content = fs.readFileSync(file, 'utf-8');

// 1. Add constants
content = content.replace(
  "const CONTEXT_FILE = path.join(path.dirname(ROOT), 'context.md');",
  `const CONTEXT_FILE = path.join(path.dirname(ROOT), 'context.md');
const ROUND1_RESULTS_FILE = path.join(ROOT, 'round1-results.md');
const ROUND2_RESULTS_FILE = path.join(ROOT, 'round2-results.md');
const FINAL_RESULTS_FILE = path.join(ROOT, 'final-answer.md');`
);

// 2. Replace archive section
const lines = content.split('\n');
let startIdx = -1, endIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('ARCHIVE ORIGINAL CONTEXT')) startIdx = i;
  if (startIdx > 0 && lines[i].includes("ctx = { text: newContextText, source:")) {
    endIdx = i;
    break;
  }
}

if (startIdx > 0 && endIdx > 0) {
  lines.splice(startIdx, endIdx - startIdx + 1, ROUND1_REPLACEMENT);
  content = lines.join('\n');
  console.log(`Replaced archive section (lines ${startIdx+1}-${endIdx+1})`);
}

// 3. Add final synthesis
content = content.replace('  // ---- Output ----', FINAL_SYNTHESIS + '\n  // ---- Output ----');

fs.writeFileSync(file, content, 'utf-8');
console.log('All patches applied successfully!');
