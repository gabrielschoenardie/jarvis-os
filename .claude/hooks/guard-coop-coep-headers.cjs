'use strict';
// PreToolUse guard: protect the COOP/COEP header values in vercel.json and vite.config.js.
// CLAUDE.md: "Never remove require-corp — it is load-bearing" for VAD/WASM SharedArrayBuffer support.

const fs = require('fs');

const GUARDED_TOKENS = ['require-corp', 'same-origin'];
const GUARDED_FILES = new Set(['vercel.json', 'vite.config.js']);

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolName = payload.tool_name;
  if (toolName !== 'Edit' && toolName !== 'Write') process.exit(0);

  const ti = payload.tool_input || {};
  const filePath = String(ti.file_path || '');
  const base = filePath.replace(/\\/g, '/').split('/').pop() || '';
  if (!GUARDED_FILES.has(base)) process.exit(0);

  let current = '';
  try {
    current = fs.readFileSync(filePath, 'utf8');
  } catch {
    process.exit(0); // new file, nothing to protect yet
  }

  let newContent = null;
  if (toolName === 'Write') {
    newContent = String(ti.content || '');
  } else {
    const oldStr = String(ti.old_string || '');
    const newStr = String(ti.new_string || '');
    if (oldStr && current.includes(oldStr)) {
      newContent = current.replace(oldStr, newStr);
    }
  }

  const removed = GUARDED_TOKENS.filter((tok) => {
    const hadBefore = current.includes(tok);
    if (!hadBefore) return false;
    if (newContent !== null) return !newContent.includes(tok);
    // Fallback when old_string can't be located verbatim in the file:
    // only flag if old_string mentions the token and new_string drops it.
    const oldStr = String(ti.old_string || '');
    const newStr = String(ti.new_string || '');
    return oldStr.includes(tok) && !newStr.includes(tok);
  });

  if (removed.length === 0) process.exit(0);

  const reason = `Blocked: this edit removes ${removed.join(' and ')} from ${base}. CLAUDE.md states these COOP/COEP header values are "load-bearing" for VAD/WASM and must never be removed. If this is intentional, confirm explicitly with the user first.`;
  process.stderr.write(reason + '\n');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
});
