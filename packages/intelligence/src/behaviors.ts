import type { WorkerBehavior } from "@ether/schema";

export const transformationBehaviors = ["rewrite", "mutate"] as const satisfies readonly WorkerBehavior[];

export const transformationContract = [
  "Return transformed content only.",
  "Do not describe the prior content.",
  "Do not use contrastive phrases unless the instruction explicitly requests comparison or contrast.",
  "Preserve unaffected details.",
  "Match the requested output schema exactly."
] as const;

export function isTransformationBehavior(behavior: WorkerBehavior): boolean {
  return transformationBehaviors.some((candidate) => candidate === behavior);
}

export function behaviorInstructions(behavior: WorkerBehavior): readonly string[] {
  return isTransformationBehavior(behavior) ? transformationContract : [];
}

export function compileBehaviorInstruction(behavior: WorkerBehavior, authoredInstruction: string): string {
  const contract = behaviorInstructions(behavior);
  if (contract.length === 0) return authoredInstruction;
  const sections = [authoredInstruction.trim(), "Transformation contract:", ...contract.map((line) => `- ${line}`)];
  return sections.filter((section, index) => section.length > 0 || index > 0).join("\n");
}

export function instructionRequestsContrast(instruction: string): boolean {
  const intentPattern = /\b(?:compare|comparison|contrast|contrasting|versus|vs\.?|before\s+and\s+after)\b/i;
  const negationPattern = /\b(?:do\s+not|don't|never|without|avoid|avoiding|must\s+not|mustn't|should\s+not|shouldn't|cannot|can't|no|not)\b/i;
  return instruction.split(/[.!?;\n]+/).some((clause) =>
    intentPattern.test(clause) && !negationPattern.test(clause)
  );
}
