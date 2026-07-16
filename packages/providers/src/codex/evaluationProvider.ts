import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProviderUnavailableError } from "../errors.js";
import { removeInvalidPathCharacters } from "../pathSanitization.js";
import type {
  ProviderDiagnostic,
  ProviderDiagnosticContext,
  ProviderProcessRunner,
  VisionEvaluationProvider,
  VisionEvaluationProviderInput,
  VisionEvaluationProviderResult
} from "../types.js";
import {
  createEvaluationWorkerRequest,
  readEvaluationWorkerResult
} from "./assistantWorkerProtocol.js";
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

export const CODEX_VISION_EVALUATION_PROVIDER_ID = "codex-vision-evaluation";

export type CodexCliVisionEvaluationProviderOptions = CodexCliProviderOptions;

export class CodexCliVisionEvaluationProvider implements VisionEvaluationProvider {
  readonly descriptor = {
    id: CODEX_VISION_EVALUATION_PROVIDER_ID,
    name: "Codex CLI / Vision Evaluation",
    route: "codex-cli" as const,
    capabilities: ["evaluation.vision", "assistant.vision", "image.reference-input"] as const,
    model: "Codex vision worker",
    notes: [
      "Uses local codex exec workers with prompt and image inputs.",
      "OpenAI Platform API, SDK, curl, browser automation, desktop automation, and API-key fallback routes are blocked."
    ]
  };

  private readonly codexCliPath: string | null;
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  private readonly fileExists: (filePath: string) => Promise<boolean> | boolean;
  private readonly runner: ProviderProcessRunner;
  private readonly processTimeoutMs: number;
  private readonly processOutputLimitBytes: number;

  constructor(options: CodexCliVisionEvaluationProviderOptions = {}) {
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
        visionEvaluationFeatureStable: true
      }
    });
  }

  async evaluate(input: VisionEvaluationProviderInput): Promise<VisionEvaluationProviderResult> {
    const codexCliPath = await this.requireAvailableCodexCliPath();
    const job = await createEvaluationJobPaths(input);
    const requestPath = path.join(job.jobDir, "request.json");
    const lastMessagePath = path.join(job.jobDir, "last-message.txt");

    await writeFile(
      requestPath,
      JSON.stringify(createEvaluationWorkerRequest(input, job.outputDir), null, 2),
      "utf8"
    );

    const prompt = buildCodexEvaluationPrompt(input, job.outputDir);
    const args = buildCodexEvaluationExecArgs(input, prompt, lastMessagePath);
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

    const workerResult = await readEvaluationWorkerResult(path.join(job.outputDir, "result.json"));

    if (workerResult.status === "failed") {
      throw new Error(`Codex evaluation worker failed: ${workerResult.error || "unknown failure"}`);
    }

    if (workerResult.status !== "complete") {
      throw new Error(`Codex evaluation worker returned unsupported status "${workerResult.status}".`);
    }

    return {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      items: workerResult.items,
      summary: workerResult.summary,
      metadata: {
        jobId: job.jobId,
        jobDir: job.jobDir,
        outputDir: job.outputDir,
        route: this.descriptor.route,
        workerResult
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

function buildCodexEvaluationExecArgs(
  input: VisionEvaluationProviderInput,
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

  for (const image of input.images) {
    args.push("--image", image.assetPath);
  }

  args.push("-");
  return args;
}

function buildCodexEvaluationPrompt(input: VisionEvaluationProviderInput, outputDir: string) {
  const resultPath = path.join(outputDir, "result.json");
  const images = input.images
    .map((image, index) =>
      [
        `${index + 1}. id=${image.id}`,
        `node=${image.nodeId}`,
        `title=${image.title}`,
        `assetId=${image.assetId ?? "not provided"}`,
        `path=${image.assetPath}`,
        image.tags?.length ? `priorTags=${image.tags.join(", ")}` : "",
        image.decision ? `priorDecision=${image.decision}` : "",
        image.notes ? `notes=${image.notes}` : ""
      ]
        .filter(Boolean)
        .join("; ")
    )
    .join("\n");

  return `Evaluate Ether image outputs as a Codex vision worker.

Use the local Codex context and supplied images only. Do not use OPENAI_API_KEY, the OpenAI Platform API, direct APIs, SDKs, curl, Firebase, browser automation, or desktop automation.

Evaluation instruction:
${input.instruction || "(empty instruction)"}

Criteria:
${input.criteria || "(none)"}

Decision threshold:
${input.threshold}

Images:
${images || "None"}

Output directory:
${outputDir}

Write this minimal worker result JSON exactly here:
${resultPath}

Required JSON shape:
{
  "id": "${input.runId}-${input.evaluationNodeId}",
  "status": "complete",
  "items": [
    {
      "id": "matching image id",
      "assetId": "matching asset id when provided",
      "assetPath": "matching asset path when useful",
      "score": 0,
      "tags": ["concise tag"],
      "decision": "pass",
      "confidence": 0.0,
      "explanation": "one or two sentence visual rationale",
      "detectedIssues": ["specific issue"]
    }
  ],
  "summary": "brief evaluation summary",
  "error": null,
  "caveats": ""
}

Rules:
- Inspect each supplied image directly.
- Return exactly one item per supplied image, preserving the image id.
- score must be a number from 0 to 100.
- decision must be "pass", "needs-edit", or "fail"; use the threshold to decide pass/fail and needs-edit for borderline images.
- confidence must be a number from 0 to 1.
- tags and detectedIssues must be arrays of strings; use an empty detectedIssues array when nothing material is wrong.
- explanation must be non-empty and grounded in visible image evidence and the instruction.
- If native vision reasoning is unavailable, write the same JSON shape with "status": "failed", "items": [], and a concise "error".
- Do not ask questions.
`;
}

async function createEvaluationJobPaths(input: VisionEvaluationProviderInput) {
  const jobId = `${sanitizePathSegment(input.evaluationNodeId)}-${randomUUID()}`;
  const jobDir = path.join(input.projectPath, "runs", "providers", input.runId, jobId);
  const outputDir = path.join(jobDir, "outputs");

  await mkdir(outputDir, { recursive: true });

  return { jobId, jobDir, outputDir };
}

function sanitizePathSegment(value: string) {
  const safe = removeInvalidPathCharacters(value.trim())
    .replace(/\s+/g, "-")
    .replace(/[. ]+$/g, "");

  return safe || "evaluation";
}
