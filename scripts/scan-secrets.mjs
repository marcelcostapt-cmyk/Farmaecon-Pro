import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

// Detection only. Never print matched values or write/rewrite Git history.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean);
const patterns = [
  ['marketplace token', /APP_USR-[A-Za-z0-9_-]{20,}/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['private key', /^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/m],
  ['cloud access key', /\bAKIA[A-Z0-9]{16}\b/],
  ['embedded ML secret', /(?:ML_SECRET_KEY|MERCADOLIVRE_CLIENT_SECRET)\s*[:=]\s*["'][A-Za-z0-9_\/-]{24,}["']/],
];
const findings = [];
for (const file of new Set(files)) {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
  const data = readFileSync(file); if (data.includes(0)) continue;
  const content = data.toString('utf8');
  for (const [kind, pattern] of patterns) if (pattern.test(content)) findings.push({ file, kind });
  if (/(^|\/)\.env(?:\.|$)/.test(file)) {
    if (!file.endsWith('.example')) findings.push({ file, kind: 'tracked runtime environment file' });
    else for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY)|ML_APP_ID)\s*=\s*(.*?)\s*$/);
      if (match && match[2].replace(/^["']|["']$/g, '').trim()) findings.push({ file, kind: `nonempty template field ${match[1]}` });
    }
  }
}
if (findings.length) {
  console.error(JSON.stringify({ status: 'FAIL', findings })); process.exitCode = 1;
} else console.log(`PASS: ${files.length} tracked/candidate files scanned; no supported credential patterns or populated secret template fields found. History, backups and remote runtime stores are outside this scan.`);
