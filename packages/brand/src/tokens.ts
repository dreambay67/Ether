export const brandTokens = {
  productName: "ETHER",
  lockup: "ETHER by DreamBay",
  colors: {
    electricBlue: "#1470DB",
    commandSurface: "#070B12",
    panelSurface: "rgba(10, 18, 30, 0.82)",
    neutralDepth: "#101825",
    cyanSignal: "#37E6EA",
    aquaSignal: "#7EF4D7",
    violetAccent: "#8A5CFF",
    textPrimary: "#F4F8FF",
    textMuted: "#99A8BA"
  },
  radii: {
    panel: "8px",
    control: "6px"
  }
} as const;

export type BrandTokens = typeof brandTokens;
