import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProviderUnavailableError } from "../errors.js";
import type {
  AssistantProvider,
  AssistantProviderInput,
  ProviderAssistantResult,
  ProviderDiagnostic,
  ProviderDiagnosticContext,
  ProviderProcessRunner
} from "../types.js";
import {
  createAssistantWorkerRequest,
  readAssistantWorkerResult
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

export const CODEX_ASSISTANT_PROVIDER_ID = "codex-vision-assistant";

export class CodexCliAssistantProvider implements AssistantProvider {
  readonly descriptor = {
    id: CODEX_ASSISTANT_PROVIDER_ID,
    name: "Codex CLI / Vision Assistant",
    route: "codex-cli" as const,
    capabilities: ["assistant.text", "assistant.vision", "image.reference-input"] as const,
    model: "Codex vision worker",
    notes: [
      "Uses local codex exec workers with prompt and image inputs.",
      "OpenAI Platform API, SDK, curl, and API-key fallback routes are blocked."
    ]
  };

  private readonly codexCliPath: string | null;
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  private readonly fileExists: (filePath: string) => Promise<boolean> | boolean;
  private readonly runner: ProviderProcessRunner;
  private readonly processTimeoutMs: number;
  private readonly processOutputLimitBytes: number;

  constructor(options: CodexCliProviderOptions = {}) {
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
        assistantVisionFeatureStable: true
      }
    });
  }

  async run(input: AssistantProviderInput): Promise<ProviderAssistantResult> {
    const codexCliPath = await this.requireAvailableCodexCliPath();
    const job = await createAssistantJobPaths(input);
    const requestPath = path.join(job.jobDir, "request.json");
    const lastMessagePath = path.join(job.jobDir, "last-message.txt");

    await writeFile(
      requestPath,
      JSON.stringify(createAssistantWorkerRequest(input, job.outputDir), null, 2),
      "utf8"
    );

    const prompt = buildCodexAssistantPrompt(input, job.outputDir);
    const args = buildCodexAssistantExecArgs(input, prompt, lastMessagePath);
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

    const workerResult = await readAssistantWorkerResult(path.join(job.outputDir, "result.json"));

    if (workerResult.status === "failed") {
      throw new Error(`Codex assistant worker failed: ${workerResult.error || "unknown failure"}`);
    }

    if (workerResult.status !== "complete") {
      throw new Error(`Codex assistant worker returned unsupported status "${workerResult.status}".`);
    }

    if (!workerResult.text) {
      throw new Error("Codex assistant worker result.json did not include text.");
    }

    return {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      text: workerResult.text,
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

function buildCodexAssistantExecArgs(
  input: AssistantProviderInput,
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

function buildCodexAssistantPrompt(input: AssistantProviderInput, outputDir: string) {
  const resultPath = path.join(outputDir, "result.json");
  const sections = input.sections
    .map((section) => `${section.title} [${section.kind}]\n${section.text}`)
    .join("\n\n");
  const references = input.references
    .map((reference, index) =>
      [
        `${index + 1}. role=${reference.role}`,
        `title=${reference.title}`,
        `kind=${reference.sourceKind}`,
        `path=${reference.assetPath ?? "not provided"}`,
        reference.steeringText ? `guidance=${reference.steeringText}` : ""
      ]
        .filter(Boolean)
        .join("; ")
    )
    .join("\n");

  return `Run an Ether Assistant node as a Codex text/vision worker.

Use the local Codex context and supplied images only. Do not use OPENAI_API_KEY, the OpenAI Platform API, direct APIs, SDKs, curl, Firebase, browser automation, or desktop automation.

Assistant subtype:
${input.assistantSubtype}

Instruction:
${input.instruction || "(empty instruction)"}

Notes:
${input.notes || "(none)"}

Assembled upstream prompt/context:
${input.prompt || "(empty prompt)"}

Prompt sections:
${sections || "None"}

Reference images:
${references || "None"}

Output directory:
${outputDir}

Write this minimal worker result JSON exactly here:
${resultPath}

Required JSON shape:
{
  "id": "${input.runId}-${input.assistantNodeId}",
  "status": "complete",
  "text": "assistant output text",
  "error": null,
  "caveats": ""
}

Rules:
- Inspect any supplied images directly when answering.
- Produce useful workflow text for the node subtype. Brainstormer should propose options, Mutator should rewrite/alter, Expander should enrich, Reinforcer should tighten and preserve constraints.
- Keep the output ready to feed downstream prompt or generation nodes.
- Return final usable prompt/context text only. Do not narrate the edit relative to the previous state.
- For rewrite or mutation requests, execute the requested change as if the new prompt had always been true. Write "holding a pineapple", not "holding a pineapple instead of a watermelon".
- Avoid meta phrases such as "changed from", "replaced with", "instead of", "rather than", "I changed", or "here is".
- If native vision/text reasoning is unavailable, write the same JSON shape with "status": "failed", "text": "", and a concise "error".
- Do not ask questions.
`;
}

async function createAssistantJobPaths(input: AssistantProviderInput) {
  const jobId = `${sanitizePathSegment(input.assistantNodeId)}-${randomUUID()}`;
  const jobDir = path.join(input.projectPath, "runs", "providers", input.runId, jobId);
  const outputDir = path.join(jobDir, "outputs");

  await mkdir(outputDir, { recursive: true });

  return { jobId, jobDir, outputDir };
}

function sanitizePathSegment(value: string) {
  const safe = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[. ]+$/g, "");

  return safe || "generation";
}
