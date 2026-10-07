import { spawnSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export const OUTPUT_TAIL_CHARS = 4000;
const sensitiveName = /password|passwd|secret|token|key|credential|authorization|database_url|redis_url/i;

function secretValues(env) {
  return [...new Set(Object.entries(env)
    .filter(([name, value]) => sensitiveName.test(name) && typeof value === 'string' && value.length > 0)
    .flatMap(([, value]) => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]))]
    .sort((a, b) => b.length - a.length);
}

export function createRedactor(env = process.env) {
  const values = secretValues(env);
  return value => {
    let text = String(value ?? '');
    for (const secret of values) text = text.split(secret).join('[REDACTED]');
    return text;
  };
}

export function logEvent(event, { env = process.env, logger = console.log } = {}) {
  const redact = createRedactor(env);
  const scrub = value => {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
    return value;
  };
  const safe = scrub({ timestamp: new Date().toISOString(), ...event });
  logger(JSON.stringify(safe));
  return safe;
}

function safeError(error, env) {
  const redact = createRedactor(env);
  const message = redact(error?.message ?? error);
  return error instanceof AggregateError
    ? new AggregateError(error.errors.map(item => safeError(item, env)), message)
    : new Error(message);
}

function processRecord(command, args, result, env, startedAt) {
  const redact = createRedactor(env);
  return {
    event: 'process.end', startedAt, command: redact(command), args: args.map(redact),
    status: result.status ?? null, signal: result.signal ?? null,
    spawnError: result.error ? { name: redact(result.error.name), code: redact(result.error.code), message: redact(result.error.message) } : null,
    // Redact BEFORE truncation: a secret crossing the tail boundary must not leak.
    stdout: redact(result.stdout).slice(-OUTPUT_TAIL_CHARS),
    stderr: redact(result.stderr).slice(-OUTPUT_TAIL_CHARS),
  };
}

export function runCommand(command, args, {
  env = process.env, execute = spawnSync, logger = console.log, timeout = 240000,
  allowFailure = false, logSuccess = true, forwardEvents = false,
} = {}) {
  const startedAt = new Date().toISOString();
  let result;
  try { result = execute(command, args, { env, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { result = { error, status: null, signal: null }; }
  const failed = Boolean(result.error) || result.status !== 0;
  if (forwardEvents) {
    // Preserve the restore's audit events even when they precede the last 4 KB.
    // Never forward raw child output: every parsed event is sanitized again.
    for (const line of `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split('\n')) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (typeof event?.event === 'string' && typeof event.timestamp === 'string') logEvent(event, { env, logger });
    }
  }
  const record = processRecord(command, args, result, env, startedAt);
  if (logSuccess || failed) logEvent(record, { env, logger });
  if (result.error || (failed && !allowFailure)) throw new Error(`Command failed: ${JSON.stringify(record)}`);
  return result;
}

// Drain piped output without unbounded buffering. Hold enough characters to
// redact known secrets even when they arrive split across stream chunks.
function outputTail(stream, env) {
  const redact = createRedactor(env);
  const hold = Math.max(1, ...secretValues(env).map(value => value.length));
  const decoder = new StringDecoder('utf8');
  let pending = '', tail = '';
  stream?.on('data', chunk => {
    pending = redact(pending + decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    const boundary = Math.max(0, pending.length - hold);
    tail = (tail + pending.slice(0, boundary)).slice(-OUTPUT_TAIL_CHARS);
    pending = pending.slice(boundary);
  });
  return () => redact(tail + pending + decoder.end()).slice(-OUTPUT_TAIL_CHARS);
}

export function captureProcess(child, command, args, { env = process.env, logger = console.log } = {}) {
  const startedAt = new Date().toISOString();
  const stdout = outputTail(child.stdout, env), stderr = outputTail(child.stderr, env);
  let error;
  const completion = new Promise((resolve, reject) => {
    child.once('error', value => { error = value; });
    child.once('close', (status, signal) => {
      const result = { status, signal, error, stdout: stdout(), stderr: stderr() };
      if (!error && status === 0) { resolve(result); return; }
      const record = processRecord(command, args, result, env, startedAt);
      logEvent(record, { env, logger });
      reject(new Error(`Command failed: ${JSON.stringify(record)}`));
    });
  });
  completion.catch(() => {}); // Attach before streaming stdin.
  return completion;
}

export async function auditStage(stage, operation, options = {}) {
  const startedAt = Date.now();
  logEvent({ event: 'restore.stage.start', stage }, options);
  try {
    const result = await operation();
    logEvent({ event: 'restore.stage.end', stage, status: 'success', durationMs: Date.now() - startedAt }, options);
    return result;
  } catch (error) {
    const safe = safeError(error, options.env ?? process.env);
    logEvent({ event: 'restore.stage.end', stage, status: 'failure', durationMs: Date.now() - startedAt, error: safe.message }, options);
    throw safe;
  }
}

export async function withCleanup(operation, cleanup, options = {}) {
  const env = options.env ?? process.env;
  let result, original;
  try { result = await operation(); }
  catch (error) {
    original = safeError(error, env);
    logEvent({ event: 'operation.failure', error: original.message }, options);
  }
  let cleanupError;
  try { await cleanup(); }
  catch (error) {
    cleanupError = safeError(error, env);
    logEvent({ event: 'cleanup.failure', error: cleanupError.message }, options);
  }
  if (original && cleanupError) throw new AggregateError([original, cleanupError], `Operation failed: ${original.message}; cleanup also failed: ${cleanupError.message}`);
  if (original || cleanupError) throw original ?? cleanupError;
  return result;
}
