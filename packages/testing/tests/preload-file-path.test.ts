import { describe, expect, it } from "vitest";

import { createEtherBridge } from "../../../apps/desktop/src/preload/filePathBridge";

describe("preload filesystem boundary", () => {
  it("does not expose Electron file paths, filesystem APIs, or unrestricted IPC", () => {
    const bridge = createEtherBridge({
      invoke: async () => ({ ok: true, value: undefined }),
      subscribe: () => () => undefined,
      openDroppedDocument: async () => ({ ok: true, value: undefined })
    });

    expect(bridge).not.toHaveProperty("file");
    expect(JSON.stringify(Object.keys(bridge))).not.toMatch(/path|filesystem|ipc|shell/i);
  });
});
