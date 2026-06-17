import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeProviderEnv } from "./env.js";
import { ProviderUnavailableError } from "./errors.js";
import { inferMimeType } from "./mime.js";
import type {
  GeneratedArtifact,
  GenerationProvider,
  GenerationProviderInput,
  ProviderDiagnostic,
  ProviderDiagnosticContext,
  ProviderGenerationResult,
  ProviderProcessCall,
  ProviderProcessResult,
  ProviderProcessRunner
} from "./types.js";

export const CODEX_PROVIDER_ID = "codex-chatgpt-image-2";

export type CodexCliImageProviderOptions = {
  codexCliPath?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fileExists?: (filePath: string) => Promise<boolean> | boolean;
  runner?: ProviderProcessRunner;
  processTimeoutMs?: number;
  processOutputLimitBytes?: number;
};

export type CodexFailureClassification = {
  category: "local-runtime-or-sandbox" | "codex-worker";
  message: string;
};

export type ProviderProcessOptions = {
  timeoutMs?: number;
  outputLimitBytes?: number;
};

const runtimeFailureHints = [
  "readonly database",
  "failed to initialize state runtime",
  "failed to initialize in-process app-server client",
  "operation not permitted"
];
const windowsAppsCodexMessage =
  "WindowsApps Codex alias paths are blocked because they can return Access is denied. Configure a real user-local CODEX_CLI_PATH in C:\\Users\\<you>\\.codex\\config.toml.";
const defaultProcessTimeoutMs = 10 * 60 * 1000;
const defaultOutputLimitBytes = 1024 * 1024;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const crc32Table = createCrc32Table();

export class CodexCliImageProvider implements GenerationProvider {
  readonly descriptor = {
    id: CODEX_PROVIDER_ID,
    name: "Codex CLI / ChatGPT Image 2",
    route: "codex-cli" as const,
    capabilities: ["image.generate", "image.edit", "image.reference-input"] as const,
    model: "ChatGPT Image 2",
    notes: [
      "Uses local codex exec workers and the native image_gen.imagegen tool.",
      "OpenAI Platform API, SDK, curl, and API-key fallback routes are blocked."
    ]
  };

  private readonly codexCliPath: string | null;
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  private readonly fileExists: (filePath: string) => Promise<boolean> | boolean;
  private readonly runner: ProviderProcessRunner;
  private readonly processTimeoutMs: number;
  private readonly processOutputLimitBytes: number;

  constructor(options: CodexCliImageProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.codexCliPath = options.codexCliPath ?? resolveCodexCliPath(this.env);
    this.fileExists = options.fileExists ?? pathExists;
    this.processTimeoutMs = options.processTimeoutMs ?? defaultProcessTimeoutMs;
    this.processOutputLimitBytes = options.processOutputLimitBytes ?? defaultOutputLimitBytes;
    this.runner =
      options.runner ??
      ((call) =>
        runProviderProcess(call, {
          timeoutMs: this.processTimeoutMs,
          outputLimitBytes: this.processOutputLimitBytes
        }));
  }

  async diagnose(context: ProviderDiagnosticContext = {}): Promise<ProviderDiagnostic> {
    const codexCliPath = this.codexCliPath;
    const fileExists = context.fileExists ?? this.fileExists;

    if (!codexCliPath) {
      return {
        ...this.descriptor,
        capabilities: [...this.descriptor.capabilities],
        availability: "unavailable",
        messages: [
          "CODEX_CLI_PATH was not found in the user Codex config. PATH lookup is intentionally not used."
        ],
        details: {
          imageGenerationFeatureStable: true
        }
      };
    }

    if (isWindowsAppsCodexAlias(codexCliPath)) {
      return {
        ...this.descriptor,
        capabilities: [...this.descriptor.capabilities],
        availability: "unavailable",
        messages: [windowsAppsCodexMessage],
        details: {
          codexCliPath,
          imageGenerationFeatureStable: true
        }
      };
    }

    if (!(await fileExists(codexCliPath))) {
      return {
        ...this.descriptor,
        capabilities: [...this.descriptor.capabilities],
        availability: "unavailable",
        messages: [`Configured Codex CLI does not exist or is not readable: ${codexCliPath}`],
        details: {
          codexCliPath,
          imageGenerationFeatureStable: true
        }
      };
    }

    return {
      ...this.descriptor,
      capabilities: [...this.descriptor.capabilities],
      availability: "available",
      messages: ["Configured user-local Codex CLI is available."],
      details: {
        codexCliPath,
        imageGenerationFeatureStable: true
      }
    };
  }

  async generate(input: GenerationProviderInput): Promise<ProviderGenerationResult> {
    const diagnostic = await this.diagnose();

    if (diagnostic.availability !== "available") {
      throw new ProviderUnavailableError(diagnostic);
    }

    const codexCliPath = this.codexCliPath;

    if (!codexCliPath) {
      throw new ProviderUnavailableError(diagnostic);
    }

    const job = await createJobPaths(input);
    const requestPath = path.join(job.jobDir, "request.json");
    const lastMessagePath = path.join(job.jobDir, "last-message.txt");

    await writeFile(requestPath, JSON.stringify({ ...input, outputDirectory: job.outputDir }, null, 2), "utf8");

    const prompt = buildCodexPrompt(input, job.outputDir);
    const args = buildCodexExecArgs(input, prompt, lastMessagePath);
    const result = await this.runner({
      command: codexCliPath,
      args,
      cwd: input.projectPath,
      env: sanitizeProviderEnv(this.env)
    });

    await writeFile(path.join(job.jobDir, "codex-stdout.txt"), result.stdout, "utf8");
    await writeFile(path.join(job.jobDir, "codex-stderr.txt"), result.stderr, "utf8");

    if (result.exitCode !== 0) {
      const classification = classifyCodexCliFailure(`${result.stderr}\n${result.stdout}`);
      throw new Error(`${classification.message}\nCodex CLI exited with ${result.exitCode}.`);
    }

    const artifacts = await collectOutputArtifacts(job.outputDir, job.jobId);

    return {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      artifacts,
      metadata: {
        jobId: job.jobId,
        jobDir: job.jobDir,
        outputDir: job.outputDir,
        route: this.descriptor.route
      }
    };
  }
}

export function classifyCodexCliFailure(output: string): CodexFailureClassification {
  const lowered = output.toLowerCase();

  if (runtimeFailureHints.some((hint) => lowered.includes(hint))) {
    return {
      category: "local-runtime-or-sandbox",
      message:
        "Codex exec failed before image generation while accessing local Codex state or sandboxed filesystem writes."
    };
  }

  return {
    category: "codex-worker",
    message: output.trim() || "Codex exec image worker failed without stdout or stderr."
  };
}

function buildCodexExecArgs(
  input: GenerationProviderInput,
  prompt: string,
  lastMessagePath: string
) {
  const args = [
    "exec",
    "--cd",
    input.projectPath,
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--ephemeral",
    "--ignore-rules",
    "--output-last-message",
    lastMessagePath,
    "--json",
    "--config",
    'model_reasoning_effort="low"'
  ];

  for (const reference of input.references) {
    if (reference.assetPath) {
      args.push("--image", reference.assetPath);
    }
  }

  args.push(prompt);
  return args;
}

function buildCodexPrompt(input: GenerationProviderInput, outputDir: string) {
  const pngPath = path.join(outputDir, "image.png");
  const resultPath = path.join(outputDir, "result.json");
  const references = input.references
    .map((reference, index) =>
      [
        `${index + 1}. role=${reference.role}`,
        `title=${reference.title}`,
        `path=${reference.assetPath ?? "not provided"}`,
        reference.steeringText ? `guidance=${reference.steeringText}` : ""
      ]
        .filter(Boolean)
        .join("; ")
    )
    .join("\n");

  return `Generate exactly one PNG image with the native image_gen.imagegen tool.

Use Codex native image generation only. Do not use OPENAI_API_KEY, the OpenAI Platform API, direct image APIs, SDKs, curl, Firebase, browser automation, or desktop automation.

Image prompt:
${input.prompt || "(empty prompt)"}

Negative prompt:
${input.negativePrompt || "(none)"}

Reference images:
${references || "None"}

Output directory:
${outputDir}

Save the final PNG exactly here:
${pngPath}

Then write this minimal worker result JSON exactly here:
${resultPath}

Required JSON shape:
{
  "id": "${input.runId}-${input.generationNodeId}-${input.iteration}",
  "status": "complete",
  "image_path": "${pngPath}",
  "error": null,
  "caveats": ""
}

Rules:
- Use image_gen.imagegen; do not call direct image APIs.
- Use only native image generation, supplied source images, and file writes required for the final PNG/result JSON.
- Do not create placeholder art with Python, PIL, SVG, canvas, HTML, or screenshots.
- If native image generation is unavailable or the image cannot be saved, write the same JSON shape with "status": "failed", "image_path": null, and a concise "error".
- Do not ask questions.
`;
}

async function createJobPaths(input: GenerationProviderInput) {
  const jobId = `${sanitizePathSegment(input.generationNodeId)}-${input.iteration}-${randomUUID()}`;
  const jobDir = path.join(input.projectPath, "runs", "providers", input.runId, jobId);
  const outputDir = path.join(jobDir, "outputs");

  await mkdir(outputDir, { recursive: true });

  return { jobId, jobDir, outputDir };
}

async function collectOutputArtifacts(outputDir: string, jobId: string): Promise<GeneratedArtifact[]> {
  const resultPath = path.join(outputDir, "result.json");
  const expectedPngPath = path.join(outputDir, "image.png");
  const result = await readCodexWorkerResult(resultPath);

  if (result.status === "failed") {
    throw new Error(`Codex image worker failed: ${result.error || "unknown failure"}`);
  }

  if (result.status !== "complete") {
    throw new Error(`Codex image worker returned unsupported status "${result.status}".`);
  }

  if (!result.image_path) {
    throw new Error("Codex image worker result.json did not include image_path.");
  }

  if (path.resolve(result.image_path) !== path.resolve(expectedPngPath)) {
    throw new Error(`Codex image worker must report the required PNG output at ${expectedPngPath}.`);
  }

  const content = await readRequiredPngOutput(expectedPngPath);

  return [
    {
      fileName: "image.png",
      sourcePath: expectedPngPath,
      content,
      mimeType: inferMimeType(expectedPngPath),
      metadata: {
        jobId,
        workerResult: result
      }
    }
  ];
}

async function readRequiredPngOutput(filePath: string) {
  let content: Buffer;

  try {
    content = await readFile(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Codex image worker required PNG output was not found: ${filePath}`);
    }

    throw new Error(
      `Codex image worker required PNG output could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const invalidReason = getPngValidationError(content);

  if (invalidReason) {
    throw new Error(`Codex image worker output is not valid PNG bytes: ${filePath} (${invalidReason})`);
  }

  return content;
}

function getPngValidationError(content: Buffer) {
  if (content.length < pngSignature.length) {
    return "missing PNG signature";
  }

  if (!pngSignature.every((byte, index) => content[index] === byte)) {
    return "invalid PNG signature";
  }

  let offset = pngSignature.length;
  let chunkIndex = 0;
  let foundIend = false;

  while (offset < content.length) {
    if (content.length - offset < 12) {
      return "truncated PNG chunk header";
    }

    const length = content.readUInt32BE(offset);
    offset += 4;
    const typeStart = offset;
    const type = content.toString("ascii", typeStart, typeStart + 4);
    offset += 4;
    const dataStart = offset;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;

    if (dataEnd > content.length || crcEnd > content.length) {
      return `PNG chunk ${type || "(unknown)"} length exceeds file bounds`;
    }

    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) {
      return "first PNG chunk must be IHDR with length 13";
    }

    const expectedCrc = content.readUInt32BE(dataEnd);
    const actualCrc = calculateCrc32(content.subarray(typeStart, dataEnd));

    if (actualCrc !== expectedCrc) {
      return `PNG chunk ${type} CRC mismatch`;
    }

    offset = crcEnd;
    chunkIndex += 1;

    if (type === "IEND") {
      if (length !== 0) {
        return "PNG IEND chunk must have length 0";
      }

      foundIend = true;

      if (offset !== content.length) {
        return "PNG data has trailing bytes after IEND";
      }

      break;
    }
  }

  if (!foundIend) {
    return "PNG is missing IEND chunk";
  }

  return null;
}

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function calculateCrc32(content: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of content) {
    crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

async function readCodexWorkerResult(resultPath: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(resultPath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Codex image worker did not write required result file: ${resultPath}`);
    }

    throw new Error(
      `Codex image worker result file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Codex image worker result.json must be an object.");
  }

  const result = parsed as { status?: unknown; image_path?: unknown; error?: unknown };

  return {
    status: typeof result.status === "string" ? result.status : "",
    image_path: typeof result.image_path === "string" ? result.image_path : null,
    error: typeof result.error === "string" ? result.error : ""
  };
}

function resolveCodexCliPath(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
) {
  const configPath = path.join(env.USERPROFILE ?? process.env.USERPROFILE ?? "", ".codex", "config.toml");

  try {
    const raw = readFileSync(configPath, "utf8");
    const match = raw.match(/CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/);

    if (match) {
      return match[1];
    }
  } catch {
    // Fall through to the explicit environment override.
  }

  if (env.CODEX_CLI_PATH) {
    return env.CODEX_CLI_PATH;
  }

  return null;
}

function isWindowsAppsCodexAlias(filePath: string) {
  const normalized = path.normalize(filePath).toLowerCase();
  const segments = normalized.split(path.sep).filter(Boolean);
  const fileName = segments.at(-1);

  return fileName === "codex.exe" && segments.includes("windowsapps");
}

async function pathExists(filePath: string) {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function runProviderProcess(
  call: ProviderProcessCall,
  options: ProviderProcessOptions = {}
): Promise<ProviderProcessResult> {
  const timeoutMs = options.timeoutMs ?? defaultProcessTimeoutMs;
  const outputLimitBytes = options.outputLimitBytes ?? defaultOutputLimitBytes;

  return new Promise((resolve, reject) => {
    const stdout = new BoundedTextCapture(outputLimitBytes);
    const stderr = new BoundedTextCapture(outputLimitBytes);
    let timedOut = false;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(call.command, call.args, {
      cwd: call.cwd,
      env: call.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    };

    child.stdout.on("data", (chunk) => {
      stdout.append(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr.append(chunk);
    });
    child.on("error", finishReject);
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }

      if (timedOut) {
        reject(
          new Error(
            [
              `Provider process timed out after ${timeoutMs} ms: ${call.command}`,
              `stdout:\n${stdout.toString()}`,
              `stderr:\n${stderr.toString()}`
            ].join("\n")
          )
        );
        return;
      }

      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: code ?? 1
      });
    });

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
  });
}

class BoundedTextCapture {
  private readonly limitBytes: number;
  private readonly headLimitBytes: number;
  private readonly tailLimitBytes: number;
  private full = Buffer.alloc(0);
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private totalBytes = 0;
  private truncated = false;

  constructor(limitBytes: number) {
    this.limitBytes = Math.max(1, Math.floor(limitBytes));
    this.headLimitBytes = Math.max(1, Math.ceil(this.limitBytes / 2));
    this.tailLimitBytes = Math.max(1, Math.floor(this.limitBytes / 2));
  }

  append(chunk: string | Buffer | Uint8Array) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.totalBytes += buffer.length;

    if (!this.truncated) {
      const next = Buffer.concat([this.full, buffer]);

      if (next.length <= this.limitBytes) {
        this.full = next;
        return;
      }

      this.truncated = true;
      this.head = next.subarray(0, this.headLimitBytes);
      this.tail = next.subarray(Math.max(0, next.length - this.tailLimitBytes));
      this.full = Buffer.alloc(0);
      return;
    }

    const combinedTail = Buffer.concat([this.tail, buffer]);
    this.tail = combinedTail.subarray(Math.max(0, combinedTail.length - this.tailLimitBytes));
  }

  toString() {
    if (!this.truncated) {
      return this.full.toString("utf8");
    }

    const omittedBytes = Math.max(0, this.totalBytes - this.head.length - this.tail.length);

    return [
      this.head.toString("utf8"),
      `\n...[truncated ${omittedBytes} bytes]...\n`,
      this.tail.toString("utf8")
    ].join("");
  }
}

function sanitizePathSegment(value: string) {
  const safe = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[. ]+$/g, "");

  return safe || "generation";
}
