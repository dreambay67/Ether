export const isLocalDevelopmentRendererUrl = (
  rendererUrl: string | undefined,
  isDevelopment: boolean
) => {
  if (!rendererUrl || !isDevelopment) {
    return false;
  }

  try {
    const url = new URL(rendererUrl);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
};
