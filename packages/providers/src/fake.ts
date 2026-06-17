import type {
  GenerationProvider,
  GenerationProviderInput,
  ImageEditProviderInput,
  ProviderDiagnostic,
  ProviderGenerationResult
} from "./types.js";

export const FAKE_PROVIDER_ID = "ether-fake-local";

export class FakeImageProvider implements GenerationProvider {
  readonly descriptor = {
    id: FAKE_PROVIDER_ID,
    name: "Ether Fake Local",
    route: "local-fake" as const,
    capabilities: ["image.generate", "image.edit", "image.reference-input"] as const,
    model: "deterministic-svg",
    notes: ["Offline deterministic provider for tests and local workflow validation."]
  };

  diagnose(): ProviderDiagnostic {
    return {
      ...this.descriptor,
      capabilities: [...this.descriptor.capabilities],
      availability: "available",
      messages: ["Deterministic local fake provider is available."]
    };
  }

  async generate(input: GenerationProviderInput): Promise<ProviderGenerationResult> {
    const content = buildFakeSvg(input);

    return {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      artifacts: [
        {
          fileName: `fake-output-${sanitizeFileNamePart(input.generationNodeId)}-${input.iteration}.svg`,
          mimeType: "image/svg+xml",
          content,
          metadata: {
            deterministic: true
          }
        }
      ],
      metadata: {
        deterministic: true
      }
    };
  }

  async edit(input: ImageEditProviderInput): Promise<ProviderGenerationResult> {
    const content = buildFakeEditSvg(input);
    const localTool = fakeLocalToolForOperation(input.operation);

    return {
      providerId: this.descriptor.id,
      providerName: this.descriptor.name,
      capabilities: [...this.descriptor.capabilities],
      artifacts: [
        {
          fileName: `fake-edit-${sanitizeFileNamePart(input.editNodeId)}-${input.operation}-${input.iteration}.svg`,
          mimeType: "image/svg+xml",
          content,
          metadata: {
            deterministic: true,
            operation: input.operation,
            editSubtype: input.editSubtype,
            localTool
          }
        }
      ],
      metadata: {
        deterministic: true,
        operation: input.operation,
        localTool
      }
    };
  }
}

function buildFakeSvg(input: GenerationProviderInput) {
  const prompt = escapeXml(input.prompt || "No prompt supplied");
  const negativePrompt = escapeXml(input.negativePrompt || "None");
  const references = escapeXml(String(input.references.length));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="ETHER fake generated image">
  <title>ETHER_FAKE_GENERATED_IMAGE</title>
  <rect width="1024" height="1024" fill="#f7f2e8"/>
  <rect x="96" y="124" width="832" height="776" rx="36" fill="#0e1824"/>
  <circle cx="792" cy="208" r="120" fill="#1470db" opacity="0.88"/>
  <circle cx="248" cy="756" r="84" fill="#42d3c7" opacity="0.82"/>
  <rect x="152" y="202" width="720" height="116" rx="18" fill="#fff8e8"/>
  <text x="188" y="274" font-size="36" font-family="Arial, sans-serif" fill="#0e1824">ETHER fake generated image</text>
  <text x="160" y="386" font-size="24" font-family="Arial, sans-serif" fill="#fff8e8">node=${escapeXml(
    input.generationNodeId
  )} iteration=${input.iteration}</text>
  <foreignObject x="160" y="430" width="704" height="256">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; color: #fff8e8; font-size: 30px; line-height: 1.25;">${prompt}</div>
  </foreignObject>
  <text x="160" y="740" font-size="24" font-family="Arial, sans-serif" fill="#a8f0ea">negative: ${negativePrompt}</text>
  <text x="160" y="790" font-size="24" font-family="Arial, sans-serif" fill="#a8f0ea">references: ${references}</text>
</svg>`;
}

function buildFakeEditSvg(input: ImageEditProviderInput) {
  const prompt = escapeXml(input.prompt || input.instruction || "No edit prompt supplied");
  const sourceAssetId = escapeXml(input.sourceImage.assetId ?? "untracked-source");
  const sourceAssetPath = escapeXml(input.sourceImage.assetPath);
  const maskAssetId = escapeXml(input.mask?.assetId ?? "no-mask");
  const operation = escapeXml(input.operation);
  const subtype = escapeXml(input.editSubtype);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="ETHER fake edited image">
  <title>ETHER_FAKE_EDITED_IMAGE</title>
  <rect width="1024" height="1024" fill="#07111c"/>
  <rect x="76" y="86" width="872" height="852" rx="42" fill="#f4f8ff"/>
  <rect x="132" y="156" width="760" height="502" rx="28" fill="#0e1824"/>
  <path d="M172 546 C302 426 402 650 548 486 C650 370 740 424 852 314" fill="none" stroke="#37e6ea" stroke-width="28" stroke-linecap="round" opacity="0.86"/>
  <circle cx="742" cy="266" r="86" fill="#1470db" opacity="0.9"/>
  <circle cx="266" cy="548" r="74" fill="#8a5cff" opacity="0.72"/>
  <text x="132" y="728" font-size="38" font-family="Arial, sans-serif" fill="#0e1824">ETHER fake edited image</text>
  <text x="132" y="784" font-size="26" font-family="Arial, sans-serif" fill="#1470db">operation=${operation} subtype=${subtype}</text>
  <text x="132" y="832" font-size="24" font-family="Arial, sans-serif" fill="#0e1824">source=${sourceAssetId}</text>
  <text x="132" y="874" font-size="20" font-family="Arial, sans-serif" fill="#526173">mask=${maskAssetId}</text>
  <foreignObject x="132" y="902" width="760" height="86">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; color: #0e1824; font-size: 20px; line-height: 1.25;">${prompt}<br/>${sourceAssetPath}</div>
  </foreignObject>
</svg>`;
}

function fakeLocalToolForOperation(operation: ImageEditProviderInput["operation"]) {
  return operation === "upscale"
    ? {
        kind: "fake-deterministic-upscale",
        route: "local-fake"
      }
    : {
        kind: "fake-deterministic-edit",
        route: "local-fake"
      };
}

function sanitizeFileNamePart(value: string) {
  const safe = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[. ]+$/g, "");

  return safe || "generation";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
