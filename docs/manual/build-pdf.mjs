import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..", "..");
const productDirectory = path.join(root, "docs", "product");
const manualPath = path.join(productDirectory, "ether-4.0-user-manual.md");
const assetsDirectory = path.join(productDirectory, "assets", "ether-4.0");
const manifestPath = path.join(assetsDirectory, "manifest.json");
const pdfPath = path.join(productDirectory, "ether-4.0-user-manual.pdf");
const etherLogoPath = path.join(root, "packages", "brand", "src", "assets", "Ether_logo.png");
const dreamBayLogoPath = path.join(root, "packages", "brand", "src", "assets", "DB_logo.png");
const expectedLabels = [
  "start",
  "build",
  "focus",
  "run",
  "review",
  "reference-desk",
  "batch-matrix",
  "job-center",
  "artifact-observatory",
  "recipes",
  "channels-roles",
  "inspector-catalog",
  "provider-health",
  "settings",
  "recovery",
  "saving",
  "export",
  "plugin-edit-permit",
  "plugin-run-permit",
  "inspector-prompt-text",
  "inspector-prompt-worker",
  "inspector-reference-set",
  "inspector-generation-image",
  "inspector-edit-image",
  "inspector-edit-mask",
  "inspector-edit-transform",
  "inspector-review-compare",
  "inspector-review-evaluate",
  "inspector-review-filter",
  "inspector-flow-variables",
  "inspector-flow-batch",
  "inspector-flow-join",
  "inspector-output-collection",
  "inspector-output-export",
  "inspector-canvas-note",
  "inspector-canvas-drawing"
];
const captureTitles = {
  "start": "Start screen on a clean profile",
  "build": "Build workspace with the release atlas",
  "focus": "Focus workspace",
  "run": "Run workspace",
  "review": "Review workspace",
  "reference-desk": "Reference Desk with an embedded reference",
  "batch-matrix": "Batch Matrix with a five-item work set and separated concurrency controls",
  "job-center": "Job Center with durable run evidence",
  "artifact-observatory": "Artifact Observatory",
  "recipes": "Recipe Gallery",
  "channels-roles": "Channel lane and role chooser",
  "inspector-catalog": "Canvas containing all 17 canonical nodes",
  "provider-health": "Provider Health with installed runtime evidence",
  "settings": "Settings with protected Gemini API and fail-closed Antigravity safety",
  "recovery": "Production recovery status",
  "saving": "Document saving state",
  "export": "Artifact export dialog",
  "plugin-edit-permit": "Native Edit Permit confirmation",
  "plugin-run-permit": "Native exact-plan Run Permit confirmation",
  "inspector-prompt-text": "Prompt Inspector",
  "inspector-prompt-worker": "LLM Worker Inspector",
  "inspector-reference-set": "Reference Set Inspector",
  "inspector-generation-image": "Image Generator Inspector",
  "inspector-edit-image": "Image Edit Inspector",
  "inspector-edit-mask": "Mask Inspector",
  "inspector-edit-transform": "Transform Inspector",
  "inspector-review-compare": "Compare Inspector",
  "inspector-review-evaluate": "Evaluate Inspector",
  "inspector-review-filter": "Filter Inspector",
  "inspector-flow-variables": "Variables Inspector",
  "inspector-flow-batch": "Batch Inspector",
  "inspector-flow-join": "Join Inspector",
  "inspector-output-collection": "Collection Inspector",
  "inspector-output-export": "Export Inspector",
  "inspector-canvas-note": "Note Inspector",
  "inspector-canvas-drawing": "Drawing Inspector"
};
const headingCaptures = {
  "start safely": ["start"],
  "workspaces": ["build", "focus"],
  "documents, references, and recovery": ["reference-desk", "recovery"],
  "canvas, nodes, connections, and inspector": ["inspector-catalog", "channels-roles"],
  "run plans, batches, and job center": ["run", "batch-matrix", "job-center"],
  "review, collections, and export": ["review", "artifact-observatory", "export"],
  "providers and intelligent work": ["provider-health"],
  "recipes and codex plugin": ["recipes", "plugin-edit-permit", "plugin-run-permit"],
  "settings, accessibility, and privacy": ["settings", "saving"]
};

const [markdown, rawManifest, etherLogoBytes, dreamBayLogoBytes] = await Promise.all([
  readFile(manualPath, "utf8"),
  readFile(manifestPath, "utf8"),
  readFile(etherLogoPath),
  readFile(dreamBayLogoPath)
]);
const etherLogoHref = pngDataUrl(etherLogoBytes);
const dreamBayLogoHref = pngDataUrl(dreamBayLogoBytes);
const manifest = parseManifest(rawManifest);
const captures = await loadCaptures(manifest);
const firstHeading = /^# Ether 4\.0 User Manual\s*$/mu;
if (!firstHeading.test(markdown)) {
  throw new Error("The source manual must start with the frozen Ether 4.0 User Manual title.");
}
const bodyMarkdown = markdown.replace(firstHeading, "").trimStart();
const captureMap = new Map(captures.map((capture) => [capture.label, capture]));
const usedCaptures = new Set();
const renderedManual = renderMarkdown(bodyMarkdown, {
  afterHeading(heading, level) {
    if (level !== 2) return "";
    const labels = headingCaptures[heading.toLocaleLowerCase()] ?? [];
    for (const label of labels) usedCaptures.add(label);
    return labels.map((label) => captureFigure(requireCapture(captureMap, label), "feature-capture")).join("");
  }
});
const inspectorCaptures = expectedLabels
  .filter((label) => label.startsWith("inspector-") && !usedCaptures.has(label))
  .map((label) => requireCapture(captureMap, label));
for (const capture of inspectorCaptures) usedCaptures.add(capture.label);
const uncategorized = captures.filter((capture) => !usedCaptures.has(capture.label));
if (uncategorized.length > 0) {
  throw new Error(`The manual does not place release captures: ${uncategorized.map((capture) => capture.label).join(", ")}.`);
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="author" content="DreamBay">
  <meta name="description" content="Ether 4.0.0 user manual for Windows">
  <meta name="color-scheme" content="light">
  <title>Ether 4.0 User Manual</title>
  <style>${printStyles()}</style>
</head>
<body>
  <article aria-labelledby="manual-title">
    <section class="cover" role="doc-cover">
      <div class="cover-signal signal-one" aria-hidden="true"></div>
      <div class="cover-signal signal-two" aria-hidden="true"></div>
      <div class="brand-lockup">
        <img src="${escapeAttribute(etherLogoHref)}" alt="Ether">
        <span>by</span>
        <img src="${escapeAttribute(dreamBayLogoHref)}" alt="DreamBay">
      </div>
      <p class="cover-kicker">Windows release 4.0.0</p>
      <h1 id="manual-title">Ether 4.0 User Manual</h1>
      <p class="cover-deck">Build, run, review, and deliver local-first creative work from one portable <code>.ether</code> document.</p>
      <dl class="cover-facts">
        <div><dt>Product</dt><dd>ETHER by DreamBay</dd></div>
        <div><dt>Edition</dt><dd>4.0.0 release manual</dd></div>
        <div><dt>Capture source</dt><dd>Installed packaged application</dd></div>
      </dl>
    </section>
    <aside class="release-provenance" aria-label="Release capture provenance">
      <strong>Release evidence</strong>
      <p>Every application image in this manual comes from Ether 4.0.0 installed through the reviewed Windows installer under a disposable profile. The capture manifest records SHA-256 hashes for the installer, executable, fixture, and each image.</p>
      <p>Installer SHA-256: <code>${escapeHtml(manifest.installer.sha256)}</code></p>
    </aside>
    <main class="manual-content">
      ${renderedManual}
      <section class="inspector-atlas" aria-labelledby="inspector-atlas-title">
        <h2 id="inspector-atlas-title">Inspector atlas</h2>
        <p>These installed-release captures show the ordinary controls for every canonical node. Advanced sections stay subordinate to each node's primary setup and action controls.</p>
        <div class="inspector-grid">
          ${inspectorCaptureRows(inspectorCaptures)}
        </div>
      </section>
    </main>
  </article>
</body>
</html>`;

const browser = await chromium.launch({ headless: true });
const temporaryPdf = path.join(productDirectory, `.ether-4.0-user-manual-${randomUUID()}.pdf`);
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 }
  });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.emulateMedia({ media: "print" });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(() =>
    [...globalThis.document.images].every((image) => image.complete && image.naturalWidth > 0)
  );
  const missingImages = await page.locator("img").evaluateAll((images) =>
    images.filter((image) => image.naturalWidth === 0).map((image) => image.getAttribute("alt") ?? "(missing alt)")
  );
  if (missingImages.length > 0 || browserErrors.length > 0) {
    throw new Error(
      `Manual HTML did not load cleanly. Missing images: ${missingImages.join(", ") || "none"}; ` +
      `page errors: ${browserErrors.join(", ") || "none"}.`
    );
  }
  await page.pdf({
    path: temporaryPdf,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
    outline: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `
      <div style="box-sizing:border-box;color:#53647a;display:flex;font-family:'Segoe UI',Arial,sans-serif;font-size:9px;justify-content:space-between;padding:0 15mm;width:100%">
        <span>ETHER by DreamBay - User Manual 4.0.0</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`
  });
  const information = await stat(temporaryPdf);
  if (!information.isFile() || information.size < 500_000) {
    throw new Error(`Generated manual PDF is implausibly small at ${information.size} bytes.`);
  }
  await replaceFileAtomically(temporaryPdf, pdfPath);
} finally {
  await browser.close();
  await rm(temporaryPdf, { force: true });
}

process.stdout.write(
  `Built tagged Ether 4.0.0 user manual from ${captures.length} installed-release captures: ${pdfPath}\n`
);

function parseManifest(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("Release capture manifest is not valid JSON.", { cause: error });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Release capture manifest must be an object.");
  }
  if (
    value.version !== "4.0.0" ||
    value.source !== "installed-packaged-exe" ||
    value.sourceProfile !== "disposable-scoped-profile"
  ) {
    throw new Error("Release capture manifest must identify the installed Ether 4.0.0 disposable-profile workflow.");
  }
  if (
    !Array.isArray(value.labels) ||
    JSON.stringify(value.labels) !== JSON.stringify(expectedLabels) ||
    !Array.isArray(value.captures) ||
    value.captures.length !== expectedLabels.length
  ) {
    throw new Error("Release capture manifest does not contain the frozen Task 28 capture inventory.");
  }
  for (const [label, evidence] of [
    ["installer", value.installer],
    ["executable", value.executable],
    ["fixture", value.fixture]
  ]) {
    if (
      evidence === null ||
      typeof evidence !== "object" ||
      !/^[a-f0-9]{64}$/u.test(evidence.sha256 ?? "")
    ) {
      throw new Error(`Release capture manifest is missing ${label} SHA-256 evidence.`);
    }
  }
  if (value.fixture.nodeCount !== 17 || value.fixture.referenceCount < 1) {
    throw new Error("Release fixture evidence must contain all 17 canonical nodes and an embedded reference.");
  }
  if (
    value.permitEvidence?.editPermit !== "active" ||
    value.permitEvidence?.runPermit !== "active-exact-plan"
  ) {
    throw new Error("Release capture manifest is missing native Edit and exact-plan Run Permit evidence.");
  }
  return value;
}

async function loadCaptures(manifest) {
  const evidenceByLabel = new Map(manifest.captures.map((entry) => [entry.label, entry]));
  return Promise.all(expectedLabels.map(async (label) => {
    if (!/^[a-z0-9-]+$/u.test(label)) throw new Error(`Unsafe capture label: ${label}.`);
    const evidence = evidenceByLabel.get(label);
    if (evidence === undefined) throw new Error(`Capture manifest is missing evidence for ${label}.`);
    const source = path.join(assetsDirectory, `${label}.png`);
    const bytes = await readFile(source);
    const dimensions = pngDimensions(bytes);
    const digest = sha256(bytes);
    if (
      digest !== evidence.sha256 ||
      dimensions.width !== evidence.width ||
      dimensions.height !== evidence.height
    ) {
      throw new Error(`Capture ${label} does not match its installed-release manifest evidence.`);
    }
    if (dimensions.width < 300 || dimensions.height < 100) {
      throw new Error(`Capture ${label} is too small for a legible manual figure.`);
    }
    return {
      label,
      title: captureTitles[label],
      href: pngDataUrl(bytes)
    };
  }));
}

function pngDataUrl(bytes) {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function inspectorCaptureRows(captures) {
  const rows = [];
  for (let index = 0; index < captures.length; index += 2) {
    rows.push(
      `<div class="inspector-row">${
        captures.slice(index, index + 2)
          .map((capture) => captureFigure(capture, "inspector-capture"))
          .join("")
      }</div>`
    );
  }
  return rows.join("");
}

function captureFigure(capture, className) {
  const title = escapeHtml(capture.title);
  return `<figure class="${className}" data-capture-id="${capture.label}">
    <img src="${escapeAttribute(capture.href)}" alt="${escapeAttribute(capture.title)}" loading="eager">
    <figcaption>Packaged Ether release capture - ${title}</figcaption>
  </figure>`;
}

function requireCapture(map, label) {
  const capture = map.get(label);
  if (capture === undefined) throw new Error(`Unknown manual capture ${label}.`);
  return capture;
}

function renderMarkdown(markdown, options) {
  const lines = markdown.split(/\r?\n/u);
  const slugCounts = new Map();
  let html = "";
  let paragraph = [];
  let list = null;
  let table = [];
  let quote = [];
  let code = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const body = paragraph.map((line) => inline(line.replace(/(?:\s{2}|\\)$/u, ""))).join(
      paragraph.some((line) => /(?:\s{2}|\\)$/u.test(line)) ? "<br>" : " "
    );
    html += `<p>${body}</p>`;
    paragraph = [];
  };
  const closeList = () => {
    if (list === null) return;
    html += `</${list}>`;
    list = null;
  };
  const flushTable = () => {
    if (table.length === 0) return;
    if (table.length < 2 || !isTableSeparator(table[1])) {
      throw new Error(`Malformed manual table near: ${table[0]}`);
    }
    const rows = table.map(tableCells);
    const header = rows[0];
    const bodyRows = rows.slice(2);
    const tableClass = header[0] === "Route" && header[1] === "What Ether uses"
      ? ' class="provider-route-table"'
      : "";
    html += `<table${tableClass}><thead><tr>${header.map((cell) => `<th scope="col">${inline(cell)}</th>`).join("")}</tr></thead>`;
    html += `<tbody>${bodyRows.map((row) =>
      `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`
    ).join("")}</tbody></table>`;
    table = [];
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    html += `<aside class="notice"><p>${quote.map((line) => inline(line)).join(" ")}</p></aside>`;
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    closeList();
    flushTable();
    flushQuote();
  };

  for (const line of lines) {
    if (code !== null) {
      if (line.startsWith("```")) {
        html += `<pre><code${code.language ? ` class="language-${escapeAttribute(code.language)}"` : ""}>${escapeHtml(code.lines.join("\n"))}</code></pre>`;
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }
    const fence = /^```([a-z0-9_-]*)\s*$/iu.exec(line);
    if (fence !== null) {
      flushAll();
      code = { language: fence[1] ?? "", lines: [] };
      continue;
    }
    if (/^\|.*\|\s*$/u.test(line)) {
      flushParagraph();
      closeList();
      flushQuote();
      table.push(line);
      continue;
    }
    flushTable();
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (heading !== null) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2].trim();
      const baseSlug = slugify(text);
      const count = slugCounts.get(baseSlug) ?? 0;
      slugCounts.set(baseSlug, count + 1);
      const id = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
      html += `<h${level} id="${id}">${inline(text)}</h${level}>`;
      html += options.afterHeading(text, level);
      continue;
    }
    const ordered = /^\d+\.\s+(.+)$/u.exec(line);
    const unordered = /^[-*]\s+(.+)$/u.exec(line);
    if (ordered !== null || unordered !== null) {
      flushParagraph();
      flushQuote();
      const nextList = ordered === null ? "ul" : "ol";
      if (list !== nextList) {
        closeList();
        list = nextList;
        html += `<${list}>`;
      }
      html += `<li>${inline((ordered ?? unordered)[1])}</li>`;
      continue;
    }
    closeList();
    if (line.startsWith("> ")) {
      flushParagraph();
      quote.push(line.slice(2));
      continue;
    }
    flushQuote();
    if (/^---+\s*$/u.test(line)) {
      flushParagraph();
      html += "<hr>";
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  if (code !== null) throw new Error("Manual contains an unclosed fenced code block.");
  flushAll();
  return html;
}

function inline(value) {
  let output = escapeHtml(value);
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (_match, label, href) =>
    `<a href="${escapeAttribute(assertSafeLink(href))}">${label}</a>`
  );
  output = output.replace(/`([^`]+)`/gu, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
  output = output.replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, "<em>$1</em>");
  return output;
}

function assertSafeLink(value) {
  const decoded = value.replaceAll("&amp;", "&");
  if (
    decoded.startsWith("#") ||
    /^https:\/\/[^\s]+$/u.test(decoded) ||
    /^[a-z0-9][a-z0-9._-]*\.md(?:#[a-z0-9-]+)?$/iu.test(decoded)
  ) {
    return decoded;
  }
  throw new Error(`Manual contains an unsupported link target: ${decoded}.`);
}

function slugify(value) {
  const result = value
    .toLocaleLowerCase()
    .replace(/<[^>]+>/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return result || "section";
}

function isTableSeparator(line) {
  return tableCells(line).every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function pngDimensions(bytes) {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error("Manual capture is not a valid PNG.");
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function replaceFileAtomically(source, destination) {
  const token = randomUUID();
  const backup = `${destination}.${token}.backup`;
  let previousMoved = false;
  try {
    try {
      await rename(destination, backup);
      previousMoved = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(source, destination);
  } catch (error) {
    if (previousMoved) {
      await rename(backup, destination).catch(() => undefined);
    }
    throw error;
  }
  if (previousMoved) await rm(backup, { force: true });
}

function printStyles() {
  return `
    :root {
      --electric-blue: #1470DB;
      --command-surface: #070B12;
      --neutral-depth: #101825;
      --cyan-signal: #37E6EA;
      --aqua-signal: #7EF4D7;
      --violet-accent: #8A5CFF;
      --text: #17243A;
      --muted: #53647A;
      --rule: #C8D7EA;
      --paper-tint: #F2F7FD;
    }
    @page { size: A4; margin: 16mm 15mm 18mm; }
    * { box-sizing: border-box; }
    html { background: white; }
    body {
      color: var(--text);
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.46;
      margin: 0;
    }
    article { margin: 0; }
    .cover {
      background:
        radial-gradient(circle at 82% 17%, rgba(55, 230, 234, 0.19), transparent 22%),
        radial-gradient(circle at 69% 75%, rgba(138, 92, 255, 0.2), transparent 24%),
        var(--command-surface);
      color: #F4F8FF;
      display: flex;
      flex-direction: column;
      height: 263mm;
      justify-content: center;
      margin: 0;
      overflow: hidden;
      padding: 24mm 22mm;
      position: relative;
      break-after: page;
    }
    .brand-lockup { align-items: center; display: flex; gap: 11px; margin-bottom: 31mm; }
    .brand-lockup img:first-child { height: 16mm; max-width: 52mm; object-fit: contain; }
    .brand-lockup img:last-child { height: 9mm; max-width: 44mm; object-fit: contain; }
    .brand-lockup span { color: #99A8BA; font-size: 9pt; text-transform: uppercase; }
    .cover-kicker {
      color: var(--aqua-signal);
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 0.16em;
      margin: 0 0 5mm;
      text-transform: uppercase;
    }
    .cover h1 {
      color: #F4F8FF;
      font-size: 34pt;
      letter-spacing: -0.035em;
      line-height: 1.02;
      margin: 0;
      max-width: 135mm;
    }
    .cover-deck { color: #C6D3E3; font-size: 14pt; line-height: 1.45; max-width: 132mm; }
    .cover code { color: var(--cyan-signal); }
    .cover-facts {
      border-top: 1px solid rgba(153, 168, 186, 0.35);
      display: grid;
      gap: 7mm;
      grid-template-columns: repeat(3, 1fr);
      margin: 20mm 0 0;
      padding-top: 7mm;
    }
    .cover-facts div { display: block; }
    .cover-facts dt { color: #99A8BA; font-size: 7.5pt; letter-spacing: 0.09em; text-transform: uppercase; }
    .cover-facts dd { font-size: 9pt; margin: 2mm 0 0; }
    .cover-signal { border: 1px solid rgba(126, 244, 215, 0.28); border-radius: 50%; position: absolute; }
    .signal-one { height: 70mm; right: -24mm; top: 25mm; width: 70mm; }
    .signal-two { bottom: -15mm; height: 48mm; left: 36mm; width: 48mm; }
    .release-provenance {
      background: var(--paper-tint);
      border-left: 4px solid var(--electric-blue);
      margin: 0 0 9mm;
      padding: 5mm 6mm;
    }
    .release-provenance strong { color: var(--electric-blue); font-size: 9pt; letter-spacing: 0.06em; text-transform: uppercase; }
    .release-provenance p { margin-bottom: 0; }
    h2 { break-before: page; }
    h1, h2, h3 { break-after: avoid; color: var(--neutral-depth); }
    h2 {
      border-top: 2px solid var(--electric-blue);
      font-size: 20pt;
      letter-spacing: -0.018em;
      margin: 0 0 5mm;
      padding-top: 4mm;
    }
    h3 { color: var(--electric-blue); font-size: 13pt; margin: 8mm 0 3mm; }
    p { margin: 0 0 4mm; orphans: 3; widows: 3; }
    a { color: #0E5CAD; text-decoration: underline; text-decoration-thickness: 0.5pt; }
    code {
      background: #EDF3FA;
      border-radius: 3px;
      color: #183E6A;
      font-family: Consolas, "Courier New", monospace;
      font-size: 0.92em;
      padding: 0.15em 0.35em;
    }
    pre {
      background: var(--neutral-depth);
      border-left: 3px solid var(--cyan-signal);
      border-radius: 5px;
      break-inside: avoid;
      color: #EAF3FF;
      font-size: 8.4pt;
      line-height: 1.4;
      overflow-wrap: anywhere;
      padding: 4mm;
      white-space: pre-wrap;
    }
    pre code { background: transparent; color: inherit; padding: 0; }
    ol, ul { margin: 0 0 4mm; padding-left: 6mm; }
    li { margin: 0 0 1.4mm; orphans: 2; widows: 2; }
    .notice {
      background: #EEF6FF;
      border-left: 4px solid var(--electric-blue);
      break-inside: avoid;
      margin: 5mm 0;
      padding: 4mm 5mm;
    }
    .notice p { margin: 0; }
    hr { border: 0; border-top: 1px solid var(--rule); margin: 7mm 0; }
    table {
      border-collapse: collapse;
      break-inside: auto;
      font-size: 8.25pt;
      line-height: 1.33;
      margin: 4mm 0 6mm;
      width: 100%;
    }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 0.6pt solid var(--rule); padding: 2.2mm; text-align: left; vertical-align: top; }
    th { background: var(--neutral-depth); color: #F4F8FF; font-weight: 650; }
    tbody tr:nth-child(even) td { background: #F7FAFD; }
    figure {
      break-inside: avoid;
      margin: 5mm 0 7mm;
      page-break-inside: avoid;
    }
    figure img {
      border: 0.6pt solid #B9CBE0;
      border-radius: 4px;
      display: block;
      height: auto;
      max-height: 180mm;
      object-fit: contain;
      width: 100%;
    }
    figcaption {
      color: var(--muted);
      font-size: 7.5pt;
      margin-top: 2mm;
    }
    .feature-capture { break-before: auto; }
    figure[data-capture-id="export"] img { max-height: 150mm; }
    .provider-route-table { break-before: page; }
    .inspector-atlas { break-before: page; }
    .inspector-grid { display: block; }
    .inspector-row {
      break-inside: avoid;
      display: grid;
      gap: 6mm;
      grid-template-columns: 1fr 1fr;
      margin-bottom: 6mm;
      page-break-inside: avoid;
    }
    .inspector-capture { margin: 0; }
    .inspector-capture img { max-height: 111mm; }
    .inspector-capture figcaption { min-height: 7mm; }
    @media print {
      a { color: #0E5CAD; }
      .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      h2:first-of-type { break-before: auto; }
    }
  `;
}
