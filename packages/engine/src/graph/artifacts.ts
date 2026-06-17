export type PromptSectionArtifact = {
  nodeId: string;
  kind: "prompt" | "negativePrompt";
  section: string;
  title: string;
  text: string;
};

export type ReferenceArtifact = {
  nodeId: string;
  role: string;
  title: string;
  sourceKind: string;
  steeringText?: string;
  assetId?: string;
  assetKind?: string;
  assetPath?: string;
  assetMetadata?: Record<string, unknown>;
};

export type EdgeRoleArtifact = {
  edgeId: string;
  role: string;
};

export type PromptAssembly = {
  nodeId: string;
  prompt: string;
  negativePrompt: string;
  sections: PromptSectionArtifact[];
  edgeRoles: EdgeRoleArtifact[];
};

export type GenerationInputAssembly = PromptAssembly & {
  references: ReferenceArtifact[];
};
