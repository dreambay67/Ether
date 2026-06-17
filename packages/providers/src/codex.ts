import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
};

export type CodexFailureClassification = {
  category: "local-runtime-or-sandbox" | "codex-worker";
  message: string;
};

const runtimeFailureHints = [
  "readonly database",
  "failed to initialize state runtime",
  "failed to initialize in-process app-server client",
  "operation not permitted"
];
const windowsAppsCodexMessage =
  "WindowsApps Codex alias paths are blocked because they can return Access is denied. Configure a real user-local CODEX_CLI_PATH in C:\\Users\\<you>\\.codex\\config.toml.";

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

  constructor(options: CodexCliImageProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.codexCliPath = options.codexCliPath ?? resolveCodexCliPath(this.env);
    this.fileExists = options.fileExists ?? pathExists;
    this.runner = options.runner ?? runProcess;
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

    if (artifacts.length === 0) {
      throw new Error(`Codex CLI finished but did not place an image in ${job.outputDir}`);
    }

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
  const names = await readdir(outputDir);
  const imageNames = names
    .filter((name) => /\.(png|jpe?g|webp|svg)$/i.test(name))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    imageNames.map(async (fileName) => {
      const sourcePath = path.join(outputDir, fileName);

      return {
        fileName,
        sourcePath,
        content: await readFile(sourcePath),
        mimeType: inferMimeType(sourcePath),
        metadata: {
          jobId
        }
      };
    })
  );
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

function runProcess(call: ProviderProcessCall): Promise<ProviderProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(call.command, call.args, {
      cwd: call.cwd,
      env: call.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1
      });
    });
  });
}

function sanitizePathSegment(value: string) {
  const safe = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[. ]+$/g, "");

  return safe || "generation";
}
