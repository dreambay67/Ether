import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const originalPath = path.join(repo, 'docs/product/ether-4.0-acceptance.md');
const recoveryPath = path.join(repo, 'docs/product/ether-4.0-recovery-acceptance.md');
const outputPath = path.join(repo, 'docs/evidence/ether-4.0-recovery/ledger.json');
const sourceBaselineCommit = process.env.ETHER_SOURCE_BASELINE_COMMIT || '03beeadad2ce494ca6b972791ce554a8a3b7e552';
const recoveryPlanBaselineCommit = process.env.ETHER_BASELINE_COMMIT || '537607ebc2ad4bdec476fbb987a38fadf268b125';

const areaMeta = {
  A01: { area: 'Automated gate', owners: ['T26'], evidence: ['A'], routes: ['J01'] },
  A02: { area: 'Document lifecycle', owners: ['T03'], evidence: ['A', 'P'], routes: ['J09'] },
  A03: { area: 'Crash and recovery', owners: ['T03'], evidence: ['A', 'P'], routes: ['J09'] },
  A04: { area: 'Graph editing', owners: ['T06', 'T07', 'T08'], evidence: ['A', 'P'], routes: ['J03'] },
  A05: { area: 'Channels and roles', owners: ['T10'], evidence: ['A', 'P'], routes: ['J04'] },
  A06: { area: 'Connection effects', owners: ['T11'], evidence: ['A', 'P'], routes: ['J04'] },
  A07: { area: 'Modules', owners: ['T09'], evidence: ['A', 'P', 'M'], routes: ['J05'] },
  A08: { area: 'Prompt and LLM Workers', owners: ['T14'], evidence: ['A', 'P'], routes: ['J06'] },
  A09: { area: 'Codex image provider', owners: ['T04', 'T16'], evidence: ['A', 'P', 'R'], routes: ['J01'] },
  A10: { area: 'Antigravity image provider', owners: ['T04'], evidence: ['A', 'P', 'R'], routes: ['J01'] },
  A11: { area: 'Provider capability UI', owners: ['T16'], evidence: ['A', 'P'], routes: ['J01'] },
  A12: { area: 'References and batches', owners: ['T15', 'T18'], evidence: ['A', 'P'], routes: ['J07'] },
  A13: { area: 'Review and artifacts', owners: ['T17', 'T19'], evidence: ['A', 'P', 'M'], routes: ['J08'] },
  A14: { area: 'Recipes', owners: ['T20'], evidence: ['A', 'P'], routes: ['J01'] },
  A15: { area: 'Codex plugin and MCP', owners: ['T21'], evidence: ['A', 'P'], routes: ['J10'] },
  A16: { area: 'UI, responsive behavior, accessibility', owners: ['T22', 'T23'], evidence: ['A', 'P', 'V'], routes: ['J03'] },
  A17: { area: 'Performance', owners: ['T24'], evidence: ['A'], routes: ['J03'] },
  A18: { area: 'Security and packaging', owners: ['T04', 'T28'], evidence: ['A', 'P'], routes: ['J09'] },
  A19: { area: 'Documentation and release', owners: ['T25', 'T28'], evidence: ['A', 'P', 'M'], routes: ['J01', 'J09'] },
};

const subsectionToArea = {
  '1': 'A01', '2': 'A02', '2.1': 'A02', '2.2': 'A02', '2.3': 'A02', '2.4': 'A02', '3': 'A03',
  '4.1': 'A04', '4.2': 'A05', '4.3': 'A06', '4.4': 'A07',
  '5': 'A08', '6.1': 'A09', '6.2': 'A10', '6.3': 'A11',
  '7': 'A12', '8': 'A13', '9': 'A14', '10': 'A15', '11': 'A16',
  '12': 'A17', '13': 'A18', '14': 'A19',
};

const recoveryMeta = {
  'RX-001': { owners: ['T25', 'T28'], routes: ['J01', 'J09'] },
  'RX-002': { owners: ['T05', 'T12', 'T27'], routes: ['J02'] },
  'RX-003': { owners: ['T05', 'T12', 'T27'], routes: ['J02'] },
  'RX-004': { owners: ['T05', 'T12', 'T27'], routes: ['J02'] },
  'RX-005': { owners: ['T05', 'T06', 'T27'], routes: ['J02', 'J03'] },
  'RX-006': { owners: ['T05', 'T12', 'T27'], routes: ['J02'] },
  'RX-007': { owners: ['T05', 'T12', 'T27'], routes: ['J02'] },
  'RX-008': { owners: ['T05', 'T12', 'T27'], routes: ['J02'] },
  'RX-009': { owners: ['T06', 'T08', 'T12', 'T27'], routes: ['J03'] },
  'RX-010': { owners: ['T06', 'T07', 'T27'], routes: ['J03'] },
  'RX-011': { owners: ['T06', 'T07', 'T27'], routes: ['J03'] },
  'RX-012': { owners: ['T06', 'T07', 'T27'], routes: ['J03'] },
  'RX-013': { owners: ['T07', 'T08', 'T27'], routes: ['J03'] },
  'RX-014': { owners: ['T07', 'T08', 'T27'], routes: ['J03'] },
  'RX-015': { owners: ['T07', 'T08', 'T27'], routes: ['J03'] },
  'RX-016': { owners: ['T07', 'T08', 'T27'], routes: ['J03'] },
  'RX-017': { owners: ['T09', 'T27'], routes: ['J05'] },
  'RX-018': { owners: ['T09', 'T27'], routes: ['J05'] },
  'RX-019': { owners: ['T09', 'T27'], routes: ['J05'] },
  'RX-020': { owners: ['T09', 'T27'], routes: ['J05'] },
  'RX-021': { owners: ['T10', 'T27'], routes: ['J04'] },
  'RX-022': { owners: ['T10', 'T11', 'T27'], routes: ['J04'] },
  'RX-023': { owners: ['T10', 'T11', 'T27'], routes: ['J04'] },
  'RX-024': { owners: ['T10', 'T11', 'T27'], routes: ['J04'] },
  'RX-025': { owners: ['T11', 'T13', 'T27'], routes: ['J01', 'J06'] },
  'RX-026': { owners: ['T11', 'T14', 'T27'], routes: ['J06'] },
  'RX-027': { owners: ['T13', 'T16', 'T27'], routes: ['J01', 'J06'] },
  'RX-028': { owners: ['T20', 'T27'], routes: ['J01'] },
  'RX-029': { owners: ['T25', 'T27'], routes: ['J01', 'J03'] },
  'RX-030': { owners: ['T26', 'T27', 'T28'], routes: ['J01', 'J09'] },
};

const failPatterns = [
  /blank\s*(?:or\s*black)?\s*canvas/i,
  /black-screen/i,
  /node titles are editable/i,
  /clicking empty canvas/i,
  /left-dragging empty canvas/i,
  /right-dragging empty canvas/i,
  /selected nodes move/i,
  /removing an edge by right-click/i,
  /only connected channel dots/i,
  /available dots appear/i,
  /artifact browser accepts an empty search/i,
];

function parseOriginal() {
  const lines = fs.readFileSync(originalPath, 'utf8').split(/\r?\n/);
  let major = null;
  let majorTitle = null;
  let subsection = null;
  let subsectionTitle = null;
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const majorMatch = line.match(/^## (\d+)\.\s*(.+)$/);
    if (majorMatch) { major = majorMatch[1]; majorTitle = majorMatch[2]; subsection = null; subsectionTitle = null; }
    const subMatch = line.match(/^### (\d+\.\d+)\s*(.+)$/);
    if (subMatch) { subsection = subMatch[1]; subsectionTitle = subMatch[2]; }
    const checkbox = line.match(/^- \[([ xX])\] (.+)$/);
    if (!checkbox || !major || major === '15') continue;
    const key = subsectionToArea[subsection || major];
    if (!key) throw new Error(`No area mapping for acceptance line ${index + 1}`);
    out.push({
      id: null,
      kind: 'original',
      ordinal: out.length + 1,
      sourceLine: index + 1,
      section: subsection ? `${major}.${subsection.split('.')[1]}` : major,
      sectionTitle: subsectionTitle || majorTitle,
      text: checkbox[2],
      historicalChecked: checkbox[1].toLowerCase() === 'x',
      areaCode: key,
    });
  }
  return out;
}

function parseRecovery() {
  const lines = fs.readFileSync(recoveryPath, 'utf8').split(/\r?\n/);
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^- \[([ xX])\] `(RX-\d{3})` (.+?)\s+Evidence:\s*([APMVR](?:\+[APMVR])*)\.?$/);
    if (!match) continue;
    const [, checked, id, text, evidence] = match;
    out.push({ id, kind: 'recovery', ordinal: out.length + 1, sourceLine: index + 1, section: 'RX', sectionTitle: 'Recovery-specific requirements', text, historicalChecked: checked.toLowerCase() === 'x', requiredEvidence: [...new Set(evidence.split('+'))] });
  }
  return out;
}

function classify(item) {
  if (item.historicalChecked) return 'PRESENT-UNPROVEN';
  if (item.kind === 'recovery') return 'MISSING';
  if (failPatterns.some((pattern) => pattern.test(item.text))) return 'FAIL';
  return 'PRESENT-UNPROVEN';
}

const originals = parseOriginal();
const recoveries = parseRecovery();
if (originals.length !== 220) throw new Error(`Expected 220 original checkboxes, found ${originals.length}`);
if (recoveries.length !== 30) throw new Error(`Expected 30 recovery requirements, found ${recoveries.length}`);

const areaCounters = Object.fromEntries(Object.keys(areaMeta).map((key) => [key, 0]));
const requirements = originals.map((item) => {
  const meta = areaMeta[item.areaCode];
  areaCounters[item.areaCode] += 1;
  const id = `AC-${item.areaCode}-${String(areaCounters[item.areaCode]).padStart(3, '0')}`;
  const status = classify(item);
  return {
    id, kind: item.kind, ordinal: item.ordinal, source: 'docs/product/ether-4.0-acceptance.md', sourceLine: item.sourceLine,
    section: item.section, areaCode: item.areaCode, area: meta.area, text: item.text,
    baselineChecked: item.historicalChecked, status, requiredEvidence: [...meta.evidence], ownerTasks: [...meta.owners], releaseBlocker: true,
    ownerRoutes: meta.evidence.includes('M') ? [...meta.routes] : [], evidence: [],
    priorEvidence: item.historicalChecked ? { source: 'docs/product/ether-4.0-release-audit.md', note: 'Historical checked state retained for traceability only; it is not current candidate evidence.' } : null,
    baselineCommit: recoveryPlanBaselineCommit,
    notes: item.historicalChecked ? 'Historical checkbox was checked, but recovery requires rerunning affected evidence; current status remains PRESENT-UNPROVEN.' : status === 'FAIL' ? 'Rejected-candidate audit identifies a user-visible failure at baseline; fresh evidence is required after repair.' : 'Baseline triage found no qualifying candidate evidence. Existing source may be partial; implementation presence does not advance status.'
  };
});

for (const item of recoveries) {
  const rxMeta = recoveryMeta[item.id];
  if (!rxMeta) throw new Error(`Missing recovery owner mapping for ${item.id}`);
  requirements.push({
    id: item.id, kind: item.kind, ordinal: item.ordinal, source: 'docs/product/ether-4.0-recovery-acceptance.md', sourceLine: item.sourceLine,
    section: item.section, areaCode: null, area: 'Recovery-specific', text: item.text,
    baselineChecked: item.historicalChecked, status: classify(item), requiredEvidence: item.requiredEvidence,
    ownerTasks: [...rxMeta.owners], releaseBlocker: true, ownerRoutes: item.requiredEvidence.includes('M') ? [...rxMeta.routes] : [], evidence: [],
    priorEvidence: null, baselineCommit: recoveryPlanBaselineCommit,
    notes: 'Recovery requirement added by the product-owner audit; no qualifying baseline evidence exists.'
  });
}

const journeys = [
  ['J01', 'First image', 'T13, T16, T19, T27'], ['J02', 'Node catalog', 'T05, T12, T27'], ['J03', 'Canvas editing', 'T06-T08, T27'], ['J04', 'Connections', 'T10-T11, T27'], ['J05', 'Module', 'T09, T27'],
  ['J06', 'Intelligent chain', 'T13, T14, T16, T27'], ['J07', 'References and batch', 'T13, T15, T18, T19, T27'], ['J08', 'Review and delivery', 'T13, T17, T19, T27'], ['J09', 'Durability', 'T03, T27'], ['J10', 'Plugin co-producer', 'T21, T27'],
].map(([id, name, owner]) => ({ id, name, owner, startState: null, endState: null, requiredEvidence: ['P', 'M'], actionLog: null, screenshots: [], status: 'PENDING' }));

const ledger = {
  schemaVersion: 'ether-4.0-recovery-ledger@1',
  generatedAt: '2026-08-02',
  baselineCommit: sourceBaselineCommit,
  recoveryPlanBaselineCommit,
  sourceDocuments: { original: 'docs/product/ether-4.0-acceptance.md', recovery: 'docs/product/ether-4.0-recovery-acceptance.md' },
  candidate: { commit: null, packageHash: null, installerHash: null, validatedAt: null },
  statusModel: ['OPEN', 'FAIL', 'MISSING', 'PRESENT-UNPROVEN', 'BLOCKED', 'VERIFIED-AUTO', 'VERIFIED-PACKAGED', 'OWNER-ACCEPTED'],
  evidenceClasses: { A: 'Automated', P: 'Packaged journey', M: 'Manual owner', V: 'Visual', R: 'Runtime/provider' },
  requirements,
  journeys,
  classification: { method: 'T01 baseline triage: historical checked items remain PRESENT-UNPROVEN; explicit rejected-candidate interaction failures are FAIL; recovery additions are MISSING; all other unproven implementation is PRESENT-UNPROVEN.', historicalCheckedCount: originals.filter((item) => item.historicalChecked).length },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
console.log(`Wrote ${requirements.length} requirements to ${path.relative(repo, outputPath)}`);
