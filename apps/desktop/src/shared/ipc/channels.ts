export const desktopIpcChannels = {
  document: {
    bootstrap: "ether:document:bootstrap",
    new: "ether:document:new",
    open: "ether:document:open",
    openDropped: "ether:document:open-dropped",
    save: "ether:document:save",
    saveAs: "ether:document:save-as",
    saveCopy: "ether:document:save-copy",
    compact: "ether:document:compact",
    makePortable: "ether:document:make-portable",
    close: "ether:document:close",
    event: "ether:document:event"
  },
  graph: {
    snapshot: "ether:graph:snapshot",
    applyTransaction: "ether:graph:apply-transaction"
  },
  artifacts: {
    search: "ether:artifacts:search",
    generateFake: "ether:artifacts:generate-fake",
    startDrag: "ether:artifacts:start-drag"
  },
  references: {
    list: "ether:references:list",
    act: "ether:references:act",
    chooseAndLink: "ether:references:choose-and-link"
  },
  permissions: {
    grantFolder: "ether:permissions:grant-folder",
    grantDroppedFile: "ether:permissions:grant-dropped-file"
  },
  application: {
    command: "ether:application:command",
    query: "ether:application:query",
    event: "ether:application:event"
  },
  runtime: {
    versions: "ether:runtime:versions",
    providerHealth: "ether:runtime:provider-health"
  }
} as const;

function flattenChannels(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(flattenChannels);
}

export const desktopIpcChannelList = Object.freeze(flattenChannels(desktopIpcChannels));
