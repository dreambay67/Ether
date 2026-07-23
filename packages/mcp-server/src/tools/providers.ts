import { z } from "zod";

import { applicationQuery } from "../applicationAdapter.js";
import { NonEmptyIdSchema } from "../schemas.js";
import type { EtherToolDefinition } from "../toolTypes.js";
import { readOnlyAnnotations } from "../toolTypes.js";

export const providerTools: EtherToolDefinition[] = [
  {
    name: "ether.provider.inspect",
    description: "Inspect provider health and declared capabilities without configuring or invoking a provider.",
    inputSchema: z.object({ providerId: NonEmptyIdSchema.optional() }).strict(),
    annotations: readOnlyAnnotations,
    async run({ application }, input) {
      const payload = input.providerId === undefined ? {} : { providerId: input.providerId };
      const [health, capabilities] = await Promise.all([
        applicationQuery(application, "provider.health", payload, true),
        applicationQuery(application, "provider.capabilities", payload, true)
      ]);
      return { health, capabilities };
    }
  }
];
