import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("ether", {
  shell: "desktop"
});
