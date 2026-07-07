'use strict';
// PreToolUse guard: keep ANTHROPIC_API_KEY / ELEVENLABS_API_KEY out of the client bundle (src/**).
// CLAUDE.md: "All API keys live server-side only — never in the browser bundle."

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
  const filePath = String(ti.file_path || '').replace(/\\/g, '/');

  const inSrc = /(^|\/)src\//.test(filePath);
  const inApi = /(^|\/)api\//.test(filePath);
  if (!inSrc || inApi) process.exit(0);

  const content = toolName === 'Write' ? String(ti.content || '') : String(ti.new_string || '');
  const match = content.match(/ANTHROPIC_API_KEY|ELEVENLABS_API_KEY/);
  if (!match) process.exit(0);

  const reason = `Blocked: "${match[0]}" would be written into ${filePath}, which is part of the client bundle (src/**). Per CLAUDE.md, API keys must stay server-side only (api/**) and never enter the browser bundle.`;
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
