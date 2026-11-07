/**
 * tool-sudo — run a command as root, asking the human for the sudo password in
 * the DSH question panel (masked) instead of passing it through the chat.
 *
 * The password never appears in the tool arguments, the tool result, or the
 * model context: it goes from the question panel straight into sudo's stdin.
 */

import { spawn } from 'node:child_process';

export const name = 'tool-sudo';
export const inject = ['tools', 'userQuestions'];

const OUTPUT_LIMIT = 32 * 1024;
const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;

function tail(text) {
  if (typeof text !== 'string') return '';
  return text.length <= OUTPUT_LIMIT ? text : text.slice(-OUTPUT_LIMIT);
}

function finish(code, stdout, stderr) {
  return { exitCode: Number.isInteger(code) ? code : 1, stdout: tail(stdout), stderr: tail(stderr) };
}

/** Run a process, optionally feeding one line to its stdin. */
function spawnPiped(file, argv, input, timeoutMs, signal) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, argv, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    } catch (error) {
      resolve(finish(127, '', String(error && error.message ? error.message : error)));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (code, extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolve(finish(code, stdout, extra === undefined ? stderr : `${stderr}${extra}`));
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = tail(stdout + chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = tail(stderr + chunk);
    });

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      settle(124, `\n[dsh-sudo] 超时（${timeoutMs} ms），已终止\n`);
    }, timeoutMs);

    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch {}
      settle(130, '\n[dsh-sudo] 已取消\n');
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });

    child.on('error', (error) => settle(127, `\n${String(error && error.message ? error.message : error)}\n`));
    child.on('close', (code) => settle(code === null ? 1 : code));

    if (input !== null && input !== undefined) {
      const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
      child.stdin.write(buf);
      buf.fill(0);
    }
    try {
      child.stdin.end();
    } catch {}
  });
}

/** Run the command through sudo, reusing a cached credential when present. */
async function sudoExec(command, password, timeoutMs, signal) {
  const argv = ['-S', '-p', '', '--', 'bash', '-lc', command];
  const input = password === null ? null : Buffer.from(`${password}\n`, 'utf8');
  password = null;
  const result = await spawnPiped('sudo', argv, input, timeoutMs, signal);
  if (input !== null) input.fill(0);
  return result;
}

function clampTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT;
  return Math.min(Math.max(Math.trunc(n), 1_000), MAX_TIMEOUT);
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'sudo_run',
    description:
      'Run one shell command with root privileges. The user is asked for the sudo password in a masked prompt when no cached credential exists, so never pass a password in the command or in chat. Returns stdout, stderr and the exit code; a non-zero exit is a normal result to interpret.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        description: {
          type: 'string',
          description: 'Short active-voice description of what the command does (5-10 words), shown to the user next to the password prompt.',
        },
        command: {
          type: 'string',
          description: 'The shell command to run as root, executed with bash -lc. Pass workdir changes inside the command rather than relying on state.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional timeout in milliseconds; defaults to 120000 and is capped at 600000.',
        },
      },
      required: ['description', 'command'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exitCode: { type: 'number' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
        },
      },
      render(_args, value) {
        const text = [value.stdout, value.stderr].filter(Boolean).join('\n').trimEnd();
        return [{ type: 'text', text: `${text}${text ? '\n' : ''}[exit code: ${value.exitCode}]` }];
      },
    },
    async execute(args, exec) {
      const timeoutMs = clampTimeout(args.timeoutMs);

      // A valid sudo timestamp means the password was already entered recently.
      const cached = await spawnPiped('sudo', ['-n', 'true'], null, 10_000, exec.signal);
      if (cached.exitCode === 0) return sudoExec(args.command, null, timeoutMs, exec.signal);

      let password = null;
      try {
        const answer = await ctx.userQuestions.ask({
          questions: [
            {
              id: 'sudo-password',
              header: 'sudo 密码',
              question: `需要 root 权限执行：${args.description || args.command}`,
              detail: args.command,
              secret: true,
            },
          ],
          ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
          signal: exec.signal,
        });
        const item = (answer.answers || []).find((entry) => entry.id === 'sudo-password');
        password = item && item.custom ? item.custom : null;
      } catch {
        return { exitCode: 130, stdout: '', stderr: '已取消：没有获得 sudo 密码。' };
      }

      if (!password) return { exitCode: 130, stdout: '', stderr: '没有输入密码。' };

      const result = await sudoExec(args.command, password, timeoutMs, exec.signal);
      password = null;
      return result;
    },
  });
}
