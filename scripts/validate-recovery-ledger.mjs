import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(repo, 'docs/evidence/ether-4.0-recovery/ledger.json');
const originalPath = path.join(repo, 'docs/product/ether-4.0-acceptance.md');
const recoveryPath = path.join(repo, 'docs/product/ether-4.0-recovery-acceptance.md');
const reportPath = path.join(repo, 'docs/evidence/ether-4.0-recovery/status-report.md');

const VALID_STATUSES = new Set(['OPEN', 'FAIL', 'MISSING', 'PRESENT-UNPROVEN', 'BLOCKED', 'VERIFIED-AUTO', 'VERIFIED-PACKAGED', 'OWNER-ACCEPTED']);
const VALID_EVIDENCE = new Set(['A', 'P', 'M', 'V', 'R']);
const JOURNEY_IDS = new Set(Array.from({ length: 10 }, (_, index) => `J${String(index + 1).padStart(2, '0')}`));
const SHA_RE = /^[0-9a-f]{40}$/i;
const HASH_RE = /^[0-9a-f]{64}$/i;
const INJECTION_RE = /(?:state\s*injection|inject(?:ed|ing)?\s+state|pre[-\s]?seed(?:ed)?\s+graph|direct\s+(?:database|db)\s+edit|database\s+edit|seeded\s+graph)/i;

const areaBySection = new Map([
  ['1', 'A01'], ['2', 'A02'], ['2.1', 'A02'], ['2.2', 'A02'], ['2.3', 'A02'], ['2.4', 'A02'], ['3', 'A03'], ['4.1', 'A04'], ['4.2', 'A05'], ['4.3', 'A06'], ['4.4', 'A07'], ['5', 'A08'],
  ['6.1', 'A09'], ['6.2', 'A10'], ['6.3', 'A11'], ['7', 'A12'], ['8', 'A13'], ['9', 'A14'], ['10', 'A15'], ['11', 'A16'], ['12', 'A17'], ['13', 'A18'], ['14', 'A19'],
]);

function parseSources() {
  const originals = [];
  const originalLines = fs.readFileSync(originalPath, 'utf8').split(/\r?\n/);
  let major = null;
  let subsection = null;
  for (let index = 0; index < originalLines.length; index += 1) {
    const line = originalLines[index];
    const majorMatch = line.match(/^## (\d+)\.\s*/);
    if (majorMatch) { major = majorMatch[1]; subsection = null; }
    const subMatch = line.match(/^### (\d+\.\d+)\s*/);
    if (subMatch) subsection = subMatch[1];
    const checkbox = line.match(/^- \[[ xX]\] (.+)$/);
    if (!checkbox || !major || major === '15') continue;
    const section = subsection || major;
    if (!areaBySection.has(section)) throw new Error(`Unmapped source section ${section} at line ${index + 1}`);
    originals.push({ text: checkbox[1], line: index + 1, section });
  }
  const recoveries = [];
  const recoveryLines = fs.readFileSync(recoveryPath, 'utf8').split(/\r?\n/);
  for (let index = 0; index < recoveryLines.length; index += 1) {
    const match = recoveryLines[index].match(/^- \[[ xX]\] `(RX-\d{3})` (.+?)\s+Evidence:\s*([APMVR](?:\+[APMVR])*)\.?$/);
    if (!match) continue;
    recoveries.push({ id: match[1], text: match[2], evidence: [...new Set(match[3].split('+'))], line: index + 1 });
  }
  return { originals, recoveries };
}

function push(errors, message) { errors.push(message); }

function inspectActionLog(errors, actionLog, label, sourceRoot, required) {
  if (typeof actionLog !== 'string' || actionLog.length === 0) {
    if (required) push(errors, `${label} is missing an action log.`);
    return;
  }
  const resolved = path.resolve(sourceRoot, actionLog);
  if (!fs.existsSync(resolved)) {
    if (required) push(errors, `${label} action log does not exist: ${actionLog}.`);
    return;
  }
  try {
    const contents = fs.readFileSync(resolved, 'utf8');
    if (INJECTION_RE.test(contents)) push(errors, `${label} action log contains a manual fixture/state-injection indicator.`);
  } catch (error) {
    push(errors, `${label} action log could not be read: ${error.message}`);
  }
}

function validateObject(ledger, { mode = 'baseline', candidateCommit = null, candidateHash = null, sourceRoot = repo } = {}) {
  const errors = [];
  let sources;
  try { sources = parseSources(); } catch (error) { return { errors: [`Unable to parse source acceptance: ${error.message}`], counts: {} }; }
  if (!ledger || typeof ledger !== 'object') return { errors: ['Ledger must be a JSON object.'], counts: {} };
  if (ledger.schemaVersion !== 'ether-4.0-recovery-ledger@1') push(errors, 'schemaVersion must be ether-4.0-recovery-ledger@1.');
  if (!SHA_RE.test(ledger.baselineCommit || '')) push(errors, 'baselineCommit must be a 40-character SHA-1.');
  if (!SHA_RE.test(ledger.recoveryPlanBaselineCommit || '')) push(errors, 'recoveryPlanBaselineCommit must be a 40-character SHA-1.');
  if (!['baseline', 'candidate', 'gate'].includes(mode)) push(errors, `Unknown validation mode ${mode}.`);
  if (mode !== 'baseline') {
    if (!SHA_RE.test(candidateCommit || '')) push(errors, `${mode} validation requires --candidate-commit=<40-char SHA-1>.`);
    if (!HASH_RE.test(candidateHash || '')) push(errors, `${mode} validation requires --candidate-package-hash=<64-char SHA-256>.`);
    if (ledger.candidate?.commit !== candidateCommit) push(errors, `ledger.candidate.commit does not match requested candidate commit ${candidateCommit || '<missing>'}.`);
    if (ledger.candidate?.packageHash !== candidateHash) push(errors, `ledger.candidate.packageHash does not match requested candidate package hash ${candidateHash || '<missing>'}.`);
  }
  if (!Array.isArray(ledger.requirements)) push(errors, 'requirements must be an array.');
  if (!Array.isArray(ledger.journeys)) push(errors, 'journeys must be an array.');
  if (errors.length) return { errors, counts: {} };

  const requirements = ledger.requirements;
  if (requirements.length !== 250) push(errors, `Expected exactly 250 requirements (220 original + 30 recovery), found ${requirements.length}.`);
  const ids = new Set();
  const originals = requirements.filter((item) => item.kind === 'original');
  const recoveries = requirements.filter((item) => item.kind === 'recovery');
  if (originals.length !== 220) push(errors, `Expected 220 original requirements, found ${originals.length}.`);
  if (recoveries.length !== 30) push(errors, `Expected 30 recovery requirements, found ${recoveries.length}.`);
  for (const item of requirements) {
    if (!item || typeof item !== 'object') { push(errors, 'Requirement entries must be objects.'); continue; }
    if (ids.has(item.id)) push(errors, `Duplicate requirement id: ${item.id}.`);
    ids.add(item.id);
    const required = ['id', 'kind', 'source', 'sourceLine', 'section', 'text', 'status', 'requiredEvidence', 'ownerTasks', 'releaseBlocker', 'ownerRoutes', 'evidence', 'baselineCommit', 'notes'];
    for (const field of required) if (!(field in item)) push(errors, `${item.id || '<unknown>'} is missing required field ${field}.`);
    if (!VALID_STATUSES.has(item.status)) push(errors, `${item.id || '<unknown>'} has invalid status ${item.status}.`);
    if (!Array.isArray(item.requiredEvidence) || item.requiredEvidence.length === 0 || item.requiredEvidence.some((code) => !VALID_EVIDENCE.has(code))) push(errors, `${item.id || '<unknown>'} has invalid requiredEvidence.`);
    if (!Array.isArray(item.ownerTasks) || item.ownerTasks.length === 0) push(errors, `${item.id || '<unknown>'} must name at least one owner task.`);
    if (typeof item.releaseBlocker !== 'boolean') push(errors, `${item.id || '<unknown>'} releaseBlocker must be boolean.`);
    if (!Array.isArray(item.ownerRoutes) || item.ownerRoutes.some((route) => !JOURNEY_IDS.has(route))) push(errors, `${item.id || '<unknown>'} has an invalid owner route.`);
    if (!Array.isArray(item.evidence)) push(errors, `${item.id || '<unknown>'} evidence must be an array.`);
    if (!SHA_RE.test(item.baselineCommit || '')) push(errors, `${item.id || '<unknown>'} baselineCommit must be a 40-character SHA-1.`);
    if (SHA_RE.test(ledger.recoveryPlanBaselineCommit || '') && item.baselineCommit !== ledger.recoveryPlanBaselineCommit) push(errors, `${item.id || '<unknown>'} baselineCommit does not match recoveryPlanBaselineCommit.`);
    if (Array.isArray(item.requiredEvidence) && item.requiredEvidence.includes('M') && item.ownerRoutes.length === 0) push(errors, `${item.id || '<unknown>'} requires M evidence but has no J01-J10 owner route.`);
    if (['VERIFIED-AUTO', 'VERIFIED-PACKAGED', 'OWNER-ACCEPTED'].includes(item.status)) {
      const classes = new Set(item.evidence.flatMap((record) => Array.isArray(record.classes) ? record.classes : []));
      for (const requiredClass of item.requiredEvidence) if (!classes.has(requiredClass)) push(errors, `${item.id} is ${item.status} but lacks required ${requiredClass} evidence.`);
      if (item.status === 'OWNER-ACCEPTED' && !classes.has('M')) push(errors, `${item.id} is OWNER-ACCEPTED without M evidence.`);
    }
    for (const record of item.evidence) {
      if (!record || typeof record !== 'object') { push(errors, `${item.id} has a non-object evidence record.`); continue; }
      if (!Array.isArray(record.classes) || record.classes.length === 0 || record.classes.some((code) => !VALID_EVIDENCE.has(code))) push(errors, `${item.id} has invalid evidence classes.`);
      if (!SHA_RE.test(record.commit || '')) push(errors, `${item.id} evidence must include a 40-character commit.`);
      if (!HASH_RE.test(record.packageHash || '')) push(errors, `${item.id} evidence must include a 64-character packageHash.`);
      const encoded = JSON.stringify({ actionLog: record.actionLog, captureCommand: record.captureCommand, notes: record.notes, fixture: record.fixture });
      if (INJECTION_RE.test(encoded)) push(errors, `${item.id} evidence contains a manual fixture/state-injection indicator.`);
      if (mode !== 'baseline') inspectActionLog(errors, record.actionLog, `${item.id} evidence`, sourceRoot, false);
      if (mode !== 'baseline' && candidateCommit && record.commit !== candidateCommit) push(errors, `${item.id} evidence commit ${record.commit} is stale; expected ${candidateCommit}.`);
      if (mode !== 'baseline' && candidateHash && record.packageHash !== candidateHash) push(errors, `${item.id} evidence package hash is stale; expected ${candidateHash}.`);
    }
  }
  const originalTexts = originals.sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
  if (originalTexts.length === 220) {
    const sourceIdSet = new Set(sources.originals.map((item) => `${item.line}:${item.text}`));
    for (const item of originalTexts) if (!sourceIdSet.has(`${item.sourceLine}:${item.text}`)) push(errors, `${item.id} is orphaned or its wording/source line differs from the original acceptance document.`);
  }
  const expectedRx = new Map(sources.recoveries.map((item) => [item.id, item]));
  if (recoveries.length === 30) {
    for (const item of recoveries) {
      const source = expectedRx.get(item.id);
      if (!source) push(errors, `${item.id} is orphaned or unknown.`);
      else {
        if (source.text !== item.text) push(errors, `${item.id} wording differs from recovery acceptance.`);
        if (source.evidence.join('+') !== item.requiredEvidence.join('+')) push(errors, `${item.id} required evidence differs from recovery acceptance.`);
      }
    }
    for (const source of sources.recoveries) if (!recoveries.some((item) => item.id === source.id)) push(errors, `${source.id} is missing from ledger.`);
  }

  const journeys = Array.isArray(ledger.journeys) ? ledger.journeys : [];
  const journeyIds = new Set(journeys.map((journey) => journey.id));
  if (journeys.length !== 10 || journeyIds.size !== 10 || [...JOURNEY_IDS].some((id) => !journeyIds.has(id))) push(errors, 'journeys must contain exactly J01-J10 with no duplicates.');
  for (const journey of journeys) {
    if (!journey.id || !journey.name || !journey.owner || !Array.isArray(journey.requiredEvidence)) push(errors, `${journey.id || '<unknown>'} is missing required journey fields.`);
    if (mode !== 'baseline') inspectActionLog(errors, journey.actionLog, `${journey.id} primary journey`, sourceRoot, true);
  }

  const counts = Object.fromEntries([...new Set(requirements.map((item) => item.status))].sort().map((status) => [status, requirements.filter((item) => item.status === status).length]));
  if (mode === 'gate') {
    const terminal = new Set(['VERIFIED-AUTO', 'VERIFIED-PACKAGED', 'OWNER-ACCEPTED']);
    for (const item of requirements) if (item.releaseBlocker && !terminal.has(item.status)) push(errors, `${item.id} is an open release blocker (${item.status}).`);
  }
  return { errors, counts };
}

function renderReport(ledger, result) {
  const statuses = Object.entries(result.counts).sort(([a], [b]) => a.localeCompare(b));
  const areaCounts = new Map();
  for (const item of ledger.requirements) {
    const key = item.area || 'Recovery-specific';
    const entry = areaCounts.get(key) || { total: 0, statuses: {} };
    entry.total += 1;
    entry.statuses[item.status] = (entry.statuses[item.status] || 0) + 1;
    areaCounts.set(key, entry);
  }
  const lines = [
    '# Ether 4.0 recovery baseline status report', '',
    `Generated from ledger schema ${ledger.schemaVersion} at source baseline commit \`${ledger.baselineCommit}\` (recovery-plan baseline \`${ledger.recoveryPlanBaselineCommit || 'not recorded'}\`).`,
    '', 'This is a Phase 0 triage report. It does not approve a phase gate or release.', '',
    '## Counts by current status', '', '| Status | Count |', '| --- | ---: |',
    ...statuses.map(([status, count]) => `| ${status} | ${count} |`),
    `| **Total** | **${ledger.requirements.length}** |`, '',
    '## Counts by area', '', '| Area | Total | Status breakdown |', '| --- | ---: | --- |',
    ...[...areaCounts.entries()].map(([area, entry]) => `| ${area} | ${entry.total} | ${Object.entries(entry.statuses).map(([status, count]) => `${status}: ${count}`).join('; ')} |`),
    '', '## Classification method', '', ledger.classification.method, '',
    'Historical checked items are retained in `priorEvidence` only and remain PRESENT-UNPROVEN until candidate evidence is rerun. Every requirement carries required evidence classes, owners, release-blocker state, and (for M requirements) J01-J10 owner routes.', '',
    `Validator baseline result: ${result.errors.length === 0 ? 'PASS (schema/coverage only)' : `FAIL (${result.errors.length} errors)`}.`,
  ];
  return `${lines.join('\n')}\n`;
}

function loadLedger() { return JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); }

function runSelfTest() {
  const ledger = loadLedger();
  const baseline = validateObject(ledger, { mode: 'baseline' });
  if (baseline.errors.length) throw new Error(`Self-test baseline fixture failed: ${baseline.errors.join(' | ')}`);
  const duplicate = structuredClone(ledger);
  duplicate.requirements.push(structuredClone(duplicate.requirements[0]));
  const duplicateResult = validateObject(duplicate, { mode: 'baseline' });
  if (!duplicateResult.errors.some((error) => /exactly 250|Duplicate requirement id/.test(error))) throw new Error('Self-test did not reject duplicate/incorrect-count fixture.');
  const invalidStatus = structuredClone(ledger);
  invalidStatus.requirements[0].status = 'NOPE';
  const invalidResult = validateObject(invalidStatus, { mode: 'baseline' });
  if (!invalidResult.errors.some((error) => /invalid status/.test(error))) throw new Error('Self-test did not reject invalid status fixture.');
  console.log('Recovery ledger self-test passed (baseline, duplicate, invalid-status fixtures).');
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) { runSelfTest(); process.exit(0); }
const modeArg = args.find((arg) => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'baseline';
const candidateCommit = args.find((arg) => arg.startsWith('--candidate-commit='))?.split('=')[1] || null;
const candidateHash = args.find((arg) => arg.startsWith('--candidate-package-hash='))?.split('=')[1] || null;
const ledger = loadLedger();
const result = validateObject(ledger, { mode, candidateCommit, candidateHash });
console.log(`Recovery ledger validation (${mode}): ${result.errors.length ? 'FAIL' : 'PASS'}`);
console.log(`Status counts: ${JSON.stringify(result.counts)}`);
if (args.includes('--write-report')) fs.writeFileSync(reportPath, renderReport(ledger, result), 'utf8');
if (result.errors.length) { for (const error of result.errors) console.error(`- ${error}`); process.exit(1); }
