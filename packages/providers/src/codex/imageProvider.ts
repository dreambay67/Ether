import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProviderUnavailableError } from "../errors.js";
import { inferMimeType } from "../mime.js";
import { removeInvalidPathCharacters } from "../pathSanitization.js";
import type {
  GeneratedArtifact,
  GenerationProvider,
  GenerationProviderInput,
  ImageEditProviderInput,
  ProviderDiagnostic,
  ProviderDiagnosticContext,
  ProviderGenerationResult,
  ProviderProcessRunner
} from "../types.js";
import {
  createImageEditWorkerRequest,
  createImageWorkerRequest,
  readCodexImageWorkerResult,
  readRequiredPngOutput
} from "./imageWorkerProtocol.js";
import {
  classifyCodexCliFailure,
  createCodexProviderProcessCall,
  defaultOutputLimitBytes,
  defaultProcessTimeoutMs,
  diagnoseCodexCliProvider,
  pathExists,
  resolveCodexCliPath,
  runProviderProcess,
  type CodexCliProviderOptions
} from "./processRunner.js";

export const CODEX_PROVIDER_ID = "codex-chatgpt-image-2";

export type CodexCliImageProviderOptions = CodexCliProviderOptions;

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
    return diagnoseCodexCliProvider({
      descriptor: this.descriptor,
      codexCliPath: this.codexCliPath,
      fileExists: context.fileExists ?? this.fileExists,
      featureDetails: {
        imageGenerationFeatureStable: true
      }
    });
  }

  async generate(input: GenerationProviderInput): Promise<ProviderGenerationResult> {
    const codexCliPath = await this.requireAvailableCodexCliPath();
    const job = await createJobPaths(input);
    const requestPath = path.join(job.jobDir, "request.json");
    const lastMessagePath = path.join(job.jobDir, "last-message.txt");

    await writeFile(
      requestPath,
      JSON.stringify(createImageWorkerRequest(input, job.outputDir), null, 2),
      "utf8"
    );

    const prompt = buildCodexPrompt(input, job.outputDir);
    const args = buildCodexExecArgs(input, prompt, lastMessagePath);
    const result = await this.runner(
      createCodexProviderProcessCall({
        command: codexCliPath,
        args,
        cwd: input.projectPath,
        env: this.env,
        stdin: prompt
      })
    );

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

  async edit(input: ImageEditProviderInput): Promise<ProviderGenerationResult> {
    const codexCliPath = await this.requireAvailableCodexCliPath();
    const job = await createJobPaths(input);
    const requestPath = path.join(job.jobDir, "request.json");
    const lastMessagePath = path.join(job.jobDir, "last-message.txt");

    await writeFile(
      requestPath,
      JSON.stringify(createImageEditWorkerRequest(input, job.outputDir), null, 2),
      "utf8"
    );

    const prompt = buildCodexEditPrompt(input, job.outputDir);
    const args = buildCodexEditExecArgs(input, prompt, lastMessagePath);
    const result = await this.runner(
      createCodexProviderProcessCall({
        command: codexCliPath,
        args,
        cwd: input.projectPath,
        env: this.env,
        stdin: prompt
      })
    );

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
        route: this.descriptor.route,
        operation: input.operation
      }
    };
  }

  private async requireAvailableCodexCliPath() {
    const diagnostic = await this.diagnose();

    if (diagnostic.availability !== "available") {
      throw new ProviderUnavailableError(diagnostic);
    }

    if (!this.codexCliPath) {
      throw new ProviderUnavailableError(diagnostic);
    }

    return this.codexCliPath;
  }
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

  args.push("-");
  return args;
}

function buildCodexEditExecArgs(
  input: ImageEditProviderInput,
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
    'model_reasoning_effort="low"',
    "--image",
    input.sourceImage.assetPath
  ];

  if (input.mask?.assetPath) {
    args.push("--image", input.mask.assetPath);
  }

  for (const reference of input.references) {
    if (reference.assetPath) {
      args.push("--image", reference.assetPath);
    }
  }

  args.push("-");
  return args;
}

function buildCodexPrompt(input: GenerationProviderInput, outputDir: string) {
  const pngPath = path.join(outputDir, "image.png");
  const resultPath = path.join(outputDir, "result.json");
  const outputWidth = Math.round(input.output?.width ?? 1024);
  const outputHeight = Math.round(input.output?.height ?? 1024);
  const outputAspectRatio = input.output?.aspectRatio ?? "1:1";
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

Image output:
Aspect ratio: ${outputAspectRatio}
Resolution: ${outputWidth} x ${outputHeight} px
Use this aspect ratio and pixel target as the intended final canvas. If the native image tool cannot set exact pixels, generate the closest possible composition and save a PNG in this orientation.

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

function buildCodexEditPrompt(input: ImageEditProviderInput, outputDir: string) {
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

  return `Edit exactly one PNG image with the native image_gen.imagegen tool.

Use Codex native image generation/editing only. Do not use OPENAI_API_KEY, the OpenAI Platform API, direct image APIs, SDKs, curl, Firebase, browser automation, or desktop automation.

Edit operation:
${input.operation}

Edit subtype:
${input.editSubtype}

Source image:
${input.sourceImage.assetPath}

Mask image:
${input.mask?.assetPath ?? "None"}

Edit recipe:
${input.recipe ? `${input.recipe.id}${input.recipe.label ? ` (${input.recipe.label})` : ""}` : "freeform"}

Frame:
${input.frame ? `${input.frame.mode}; x=${input.frame.x}; y=${input.frame.y}; width=${input.frame.width}; height=${input.frame.height}; canvas=${input.frame.canvasWidth ?? "unknown"}x${input.frame.canvasHeight ?? "unknown"}` : "source bounds"}

Instruction:
${input.instruction || "(empty instruction)"}

Prompt context:
${input.prompt || "(empty prompt)"}

Negative prompt:
${input.negativePrompt || "(none)"}

Notes:
${input.notes || "(none)"}

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
  "id": "${input.runId}-${input.editNodeId}-${input.iteration}",
  "status": "complete",
  "image_path": "${pngPath}",
  "error": null,
  "caveats": ""
}

Rules:
- Use image_gen.imagegen; do not call direct image APIs.
- Treat the first supplied image as the source image and the second supplied image as a mask when a mask is present.
- Preserve the source image structure unless the edit instruction explicitly asks to expand or upscale it.
- Do not create placeholder art with Python, PIL, SVG, canvas, HTML, or screenshots.
- If native image editing is unavailable or the image cannot be saved, write the same JSON shape with "status": "failed", "image_path": null, and a concise "error".
- Do not ask questions.
`;
}

async function createJobPaths(input: GenerationProviderInput | ImageEditProviderInput) {
  const nodeId = "generationNodeId" in input ? input.generationNodeId : input.editNodeId;
  const jobId = `${sanitizePathSegment(nodeId)}-${input.iteration}-${randomUUID()}`;
  const jobDir = path.join(input.projectPath, "runs", "providers", input.runId, jobId);
  const outputDir = path.join(jobDir, "outputs");

  await mkdir(outputDir, { recursive: true });

  return { jobId, jobDir, outputDir };
}

async function collectOutputArtifacts(outputDir: string, jobId: string): Promise<GeneratedArtifact[]> {
  const resultPath = path.join(outputDir, "result.json");
  const expectedPngPath = path.join(outputDir, "image.png");
  const result = await readCodexImageWorkerResult(resultPath);

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

function sanitizePathSegment(value: string) {
  const safe = removeInvalidPathCharacters(value.trim())
    .replace(/\s+/g, "-")
    .replace(/[. ]+$/g, "");

  return safe || "generation";
}
