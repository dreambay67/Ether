import { app, protocol } from "electron";

import { registerEtherAssetScheme } from "./protocol/etherAssetProtocol.js";
import { installChromiumNetworkContainment } from "./security/navigationPolicy.js";

// Electron waits for a static ESM entry graph to finish evaluating before it
// completes readiness. Register the custom scheme synchronously, then load the
// heavier application graph without making readiness depend on that graph.
installChromiumNetworkContainment(app.commandLine);
registerEtherAssetScheme(protocol);

void import("./main.js").then(({ startEtherDesktop }) => startEtherDesktop()).catch((error) => {
  if ((error as { code?: unknown } | null)?.code !== "SECOND_INSTANCE") {
    console.error(error);
    app.quit();
  }
});
