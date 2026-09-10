import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

// The npm-installed CLI ships a real native binary (bin/claude.exe on Windows) rather
// than a JS entrypoint — resolved from the package's own package.json so it works
// regardless of npm's hoisting layout. Invoking it directly (not through `npx`) avoids
// two Windows-specific problems: `npx` itself is a .cmd shim, and execFile can't spawn
// .cmd/.bat files without a shell (EINVAL) — going through a shell would mean
// re-escaping arbitrary JD text for cmd.exe, which is the class of bug behind Node's
// own advisories on this.
const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('@anthropic-ai/claude-code/package.json');
const binField = (require(packageJsonPath) as { bin: Record<string, string> }).bin.claude!;
const CLAUDE_BIN = join(dirname(packageJsonPath), binField);

/**
 * What stage 2 asks the model for. Deliberately narrower than the plan's full
 * Evaluation shape — resume_variant is a deterministic lookup (see resume.ts), not a
 * model judgment, so it's not part of what we ask for here.
 */
const LlmEvaluationSchema = z.object({
  tier: z.enum(['A', 'B', 'C', 'SKIP']),
  reason: z.string().min(1),
  missing_info: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  approval_needs: z
    .array(z.object({ field_key: z.string(), question: z.string() }))
    .default([]),
});
export type LlmEvaluation = z.infer<typeof LlmEvaluationSchema>;

const JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    tier: { type: 'string', enum: ['A', 'B', 'C', 'SKIP'] },
    reason: { type: 'string' },
    missing_info: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    approval_needs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { field_key: { type: 'string' }, question: { type: 'string' } },
        required: ['field_key', 'question'],
      },
    },
  },
  required: ['tier', 'reason', 'missing_info', 'confidence', 'approval_needs'],
});

export interface LlmCallOptions {
  maxBudgetUsd?: number;
  timeoutMs?: number;
}

/**
 * Stage 2 — the only LLM call in the evaluator. Runs the Claude Code CLI headless,
 * authenticated on this machine's own Pro/Max login (not a separate API key) — see
 * D14 in progress/03-decisions.md for why, and the tradeoffs that were flagged before
 * choosing it. `--safe-mode` skips CLAUDE.md/hooks/plugins/skills; the disallowed
 * tools list means this call can never need a permission prompt, so it runs
 * unattended.
 */
export async function rankWithLLM(prompt: string, opts: LlmCallOptions = {}): Promise<LlmEvaluation> {
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--safe-mode',
    '--no-session-persistence',
    '--model', 'sonnet',
    '--disallowedTools', 'Bash', 'PowerShell', 'Edit', 'Write', 'WebFetch', 'Agent',
    '--json-schema', JSON_SCHEMA,
    '--max-budget-usd', String(opts.maxBudgetUsd ?? 0.5),
  ];

  // If ANTHROPIC_API_KEY is set in this process's env (it is, for other parts of the
  // app), the CLI prefers it over the OAuth/Pro-Max login — which is exactly the
  // billing path this was built to avoid. Strip it for the child only.
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(CLAUDE_BIN, args, {
      timeout: opts.timeoutMs ?? 180_000,
      maxBuffer: 10 * 1024 * 1024,
      env: childEnv,
    }));
  } catch (err) {
    // Node's own error.message truncates/omits stdout on a non-zero exit or a
    // timeout kill — surface everything so a real failure is diagnosable, not just
    // "Command failed".
    const e = err as { code?: number; signal?: string; stdout?: string; stderr?: string; message: string };
    throw new Error(
      `claude CLI exited ${e.signal ? `on signal ${e.signal}` : `with code ${e.code}`}: ` +
      `stderr=${(e.stderr ?? '').slice(0, 500)} stdout=${(e.stdout ?? '').slice(0, 1000)}`,
    );
  }

  const parsed = JSON.parse(stdout) as {
    is_error: boolean;
    result: string;
    structured_output?: unknown;
  };
  if (parsed.is_error) {
    throw new Error(`evaluator LLM call failed: ${parsed.result ?? 'unknown error'}`);
  }
  const structured = parsed.structured_output ?? JSON.parse(parsed.result);
  return LlmEvaluationSchema.parse(structured);
}
