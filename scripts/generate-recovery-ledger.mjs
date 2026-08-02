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

const recoveryClassification = {
  'RX-001': { status: 'PRESENT-UNPROVEN', reason: 'Recovery acceptance and design documents now identify the candidate as unreleased; candidate evidence does not yet exist.' },
  'RX-002': { status: 'FAIL', reason: 'The rejected-candidate audit states blank-canvas authoring exposes only Prompt and Image, so the all-17-node library journey is broken.' },
  'RX-003': { status: 'FAIL', reason: 'The rejected authoring surface does not expose a complete registry-driven library, so clicking every canonical item cannot currently be completed.' },
  'RX-004': { status: 'MISSING', reason: 'The recovery design requires drag-from-library creation, but no usable blank-canvas drag journey is evidenced at baseline.' },
  'RX-005': { status: 'MISSING', reason: 'The searchable quick-add palette and keyboard insertion route are specified recovery behavior with no usable baseline surface.' },
  'RX-006': { status: 'FAIL', reason: 'The partial blank-canvas catalog does not create and validate every canonical registry default as required.' },
  'RX-007': { status: 'MISSING', reason: 'Search across family, purpose, channel, synonym, favorites, and recent is specified but not available as a usable complete catalog surface.' },
  'RX-008': { status: 'MISSING', reason: 'Per-item purpose, channel, example, and hover/focus help are recovery requirements without a complete baseline library surface.' },
  'RX-009': { status: 'FAIL', reason: 'The recovery audit identifies direct editing as incomplete; titles and primary content are not reliably editable on-canvas.' },
  'RX-010': { status: 'FAIL', reason: 'The recovery design records unreliable marquee/pointer behavior and the baseline renderer can fail during marquee interaction.' },
  'RX-011': { status: 'FAIL', reason: 'Selection ownership and group movement are called out as unreliable in the rejected candidate.' },
  'RX-012': { status: 'PRESENT-UNPROVEN', reason: 'Right-drag pan is specified in the interaction model, but no qualifying packaged proof exists at baseline.' },
  'RX-013': { status: 'MISSING', reason: 'Complete-selection duplicate with stable connections and undo is specified recovery behavior without a usable baseline journey.' },
  'RX-014': { status: 'MISSING', reason: 'Graph-aware clipboard behavior is specified recovery behavior without a usable canvas-owned clipboard journey at baseline.' },
  'RX-015': { status: 'PRESENT-UNPROVEN', reason: 'Deletion and impact-aware confirmation have implementation scope in the recovery model, but packaged proof is absent at baseline.' },
  'RX-016': { status: 'MISSING', reason: 'Command Palette graph commands and disabled-state reasons are specified but the complete authoring command surface is not available at baseline.' },
  'RX-017': { status: 'FAIL', reason: 'The recovery design explicitly retires Visual Group as a separate concept; the rejected candidate still has incomplete group/module ownership.' },
  'RX-018': { status: 'FAIL', reason: 'The recovery audit identifies modules as incomplete without coherent locking/editing ownership, so default locked membership is broken at baseline.' },
  'RX-019': { status: 'MISSING', reason: 'The full styled Module control surface is specified but no usable baseline journey exposes rename, description, accent, lock, collapse, and parameters together.' },
  'RX-020': { status: 'FAIL', reason: 'The recovery design identifies groups/modules as separate incomplete concepts, so enter/exit/conversion/dissolution semantics are broken at baseline.' },
  'RX-021': { status: 'PRESENT-UNPROVEN', reason: 'Channel-dot visibility behavior is specified in the renderer model, but qualifying packaged and visual proof is absent at baseline.' },
  'RX-022': { status: 'PRESENT-UNPROVEN', reason: 'Multi-lane channel/role/selector semantics are present in the recovery contract, but no packaged proof covers them at baseline.' },
  'RX-023': { status: 'PRESENT-UNPROVEN', reason: 'Role badges and endpoint Inspector agreement are specified interaction behavior, but no qualifying packaged/visual evidence exists at baseline.' },
  'RX-024': { status: 'PRESENT-UNPROVEN', reason: 'Edge-only lane deletion is specified in the interaction contract, but no packaged proof demonstrates it at baseline.' },
  'RX-025': { status: 'PRESENT-UNPROVEN', reason: 'Versioned outputs and authored-config isolation are required by the technical model, but no qualifying run journey proves them at baseline.' },
  'RX-026': { status: 'PRESENT-UNPROVEN', reason: 'Prompt/Worker lineage rules are specified in the connection contract, but no packaged lineage evidence exists at baseline.' },
  'RX-027': { status: 'PRESENT-UNPROVEN', reason: 'Node runtime state requirements are specified by the recovery design, but no packaged status-duration/actionability evidence exists at baseline.' },
  'RX-028': { status: 'MISSING', reason: 'Recipe acceptance explicitly requires starting from a new document; no complete blank-document recipe journey exists at baseline.' },
  'RX-029': { status: 'FAIL', reason: 'The rejected-candidate manual/screenshot evidence did not prove blank-canvas authoring from a relevant starting state and substituted the claimed authoring state.' },
  'RX-030': { status: 'PRESENT-UNPROVEN', reason: 'The application-first independent-review control is specified and queued, but final journey logs and explicit owner acceptance cannot exist at baseline.' },
};

const canonicalJourneys = [
  { id: 'J01', name: 'First image', startState: 'New blank document', endState: 'Saved generated image visible in Artifacts', requiredEvidence: ['P', 'M', 'R'], owner: 'T13, T16, T19, T27', owners: ['T13', 'T16', 'T19', 'T27'] },
  { id: 'J02', name: 'Node catalog', startState: 'New blank document', endState: 'All 17 nodes created, configured, saved, reopened', requiredEvidence: ['P', 'M'], owner: 'T05, T12, T27', owners: ['T05', 'T12', 'T27'] },
  { id: 'J03', name: 'Canvas editing', startState: 'New blank document', endState: 'Select, marquee, move, edit, duplicate, clipboard, delete, undo/redo', requiredEvidence: ['P', 'M'], owner: 'T06-T08, T27', owners: ['T06-T08', 'T27'] },
  { id: 'J04', name: 'Connections', startState: 'Representative six-channel graph', endState: 'Multi-lanes, role edit, lane delete, adapter preview', requiredEvidence: ['P', 'M'], owner: 'T10-T11, T27', owners: ['T10-T11', 'T27'] },
  { id: 'J05', name: 'Module', startState: 'Multi-node selection', endState: 'Locked styled module, enter/edit/exit/collapse/dissolve/undo', requiredEvidence: ['P', 'M'], owner: 'T09, T27', owners: ['T09', 'T27'] },
  { id: 'J06', name: 'Intelligent chain', startState: 'Prompt -> Worker -> Worker -> Image', endState: 'Approved transformed prompt and correct lineage', requiredEvidence: ['P', 'M', 'R'], owner: 'T13, T14, T16, T27', owners: ['T13', 'T14', 'T16', 'T27'] },
  { id: 'J07', name: 'References and batch', startState: 'Multiple local references', endState: 'Controlled batch with visible jobs and accepted artifacts', requiredEvidence: ['P', 'M', 'R'], owner: 'T13, T15, T18, T19, T27', owners: ['T13', 'T15', 'T18', 'T19', 'T27'] },
  { id: 'J08', name: 'Review and delivery', startState: 'Multiple artifacts', endState: 'Compare, evaluate, filter, collect, export', requiredEvidence: ['P', 'M', 'R'], owner: 'T13, T17, T19, T27', owners: ['T13', 'T17', 'T19', 'T27'] },
  { id: 'J09', name: 'Durability', startState: 'Saved working document', endState: 'Close, reopen, recover interruption, continue', requiredEvidence: ['P', 'M'], owner: 'T03, T27', owners: ['T03', 'T27'] },
  { id: 'J10', name: 'Plugin co-producer', startState: 'Blank document with Edit Permit', endState: 'Tailored graph applied; run remains separately permitted', requiredEvidence: ['P', 'M'], owner: 'T21, T27', owners: ['T21', 'T27'] },
];

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
  if (item.kind === 'recovery') return recoveryClassification[item.id]?.status || 'OPEN';
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
  const classificationReason = item.historicalChecked ? 'Historical checkbox was checked, but recovery requires rerunning affected evidence; current status remains PRESENT-UNPROVEN.' : status === 'FAIL' ? 'Rejected-candidate audit identifies a user-visible failure at baseline; fresh evidence is required after repair.' : 'Baseline triage found no qualifying candidate evidence. Existing source may be partial; implementation presence does not advance status.';
  return {
    id, kind: item.kind, ordinal: item.ordinal, source: 'docs/product/ether-4.0-acceptance.md', sourceLine: item.sourceLine,
    section: item.section, areaCode: item.areaCode, area: meta.area, text: item.text,
    baselineChecked: item.historicalChecked, status, requiredEvidence: [...meta.evidence], ownerTasks: [...meta.owners], releaseBlocker: true,
    ownerRoutes: meta.evidence.includes('M') ? [...meta.routes] : [], evidence: [],
    priorEvidence: item.historicalChecked ? { source: 'docs/product/ether-4.0-release-audit.md', note: 'Historical checked state retained for traceability only; it is not current candidate evidence.' } : null,
    baselineCommit: recoveryPlanBaselineCommit,
    classificationReason, notes: classificationReason
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
    classificationReason: recoveryClassification[item.id].reason,
    notes: recoveryClassification[item.id].reason
  });
}

const journeys = canonicalJourneys.map((journey) => ({ ...journey, actionLog: null, screenshots: [], status: 'PENDING' }));

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
  classification: { method: 'T01 baseline triage: historical checked items remain PRESENT-UNPROVEN; explicit rejected-candidate failures are FAIL; each RX item follows the evidence-based recoveryClassification map below; remaining unproven implementation is PRESENT-UNPROVEN.', historicalCheckedCount: originals.filter((item) => item.historicalChecked).length, recoveryMap: recoveryClassification },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
console.log(`Wrote ${requirements.length} requirements to ${path.relative(repo, outputPath)}`);
