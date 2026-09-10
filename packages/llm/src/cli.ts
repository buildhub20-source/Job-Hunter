import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);

// The npm-installed CLI ships a real native binary (bin/claude.exe on Windows) rather
// than a JS entrypoint — resolved from the package's own package.json so it works
// regardless of npm's hoisting layout. Invoking it directly (not through `npx`) avoids
// two Windows-specific problems: `npx` itself is a .cmd shim, and execFile can't spawn
// .cmd/.bat files without a shell (EINVAL) — going through a shell would mean
// re-escaping arbitrary untrusted text for cmd.exe, which is the class of bug behind
// Node's own advisories on this.
const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('@anthropic-ai/claude-code/package.json');
const binField = (require(packageJsonPath) as { bin: Record<string, string> }).bin.claude!;
const CLAUDE_BIN = join(dirname(packageJsonPath), binField);

export interface ClaudeCallOptions {
  /** JSON Schema (as an object, not a string) for structured output. */
  jsonSchema?: Record<string, unknown>;
  maxBudgetUsd?: number;
  timeoutMs?: number;
}

interface ClaudeResult {
  is_error: boolean;
  result: string;
  structured_output?: unknown;
}

/**
 * The only way anything in this repo calls an LLM: the Claude Code CLI headless
 * (`-p`), authenticated on this machine's own Pro/Max login rather than a separate
 * API key — see D14 in progress/03-decisions.md for why, and the tradeoffs that were
 * flagged before choosing it. `--safe-mode` skips CLAUDE.md/hooks/plugins/skills; the
 * disallowed tools list means this call can never need a permission prompt, so it
 * runs unattended.
 *
 * Returns the raw structured output (or, with no jsonSchema, the plain text result)
 * — callers validate the shape with their own zod schema, since what's being asked
 * for differs per caller (evaluator ranking vs. inbox classification).
 */
export async function callClaude(prompt: string, opts: ClaudeCallOptions = {}): Promise<unknown> {
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--safe-mode',
    '--no-session-persistence',
    '--model', 'sonnet',
    '--disallowedTools', 'Bash', 'PowerShell', 'Edit', 'Write', 'WebFetch', 'Agent',
    '--max-budget-usd', String(opts.maxBudgetUsd ?? 0.5),
  ];
  if (opts.jsonSchema) {
    args.push('--json-schema', JSON.stringify(opts.jsonSchema));
  }

  // If ANTHROPIC_API_KEY is set in this process's env (it is, elsewhere in the app),
  // the CLI prefers it over the OAuth/Pro-Max login — which is exactly the billing
  // path this was built to avoid. Strip it for the child only.
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
    const e = err as { code?: number; signal?: string; stdout?: string; stderr?: string };
    throw new Error(
      `claude CLI exited ${e.signal ? `on signal ${e.signal}` : `with code ${e.code}`}: ` +
      `stderr=${(e.stderr ?? '').slice(0, 500)} stdout=${(e.stdout ?? '').slice(0, 1000)}`,
    );
  }

  const parsed = JSON.parse(stdout) as ClaudeResult;
  if (parsed.is_error) {
    throw new Error(`LLM call failed: ${parsed.result ?? 'unknown error'}`);
  }
  if (!opts.jsonSchema) return parsed.result;
  return parsed.structured_output ?? JSON.parse(parsed.result);
}
