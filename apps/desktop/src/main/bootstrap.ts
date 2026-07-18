import { app } from "electron";

import { startEtherDesktop } from "./main.js";

void startEtherDesktop().catch((error) => {
  if ((error as { code?: unknown } | null)?.code !== "SECOND_INSTANCE") {
    console.error(error);
    app.quit();
  }
});
