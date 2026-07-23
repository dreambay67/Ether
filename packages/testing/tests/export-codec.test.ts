import { describe, expect, it } from "vitest";

import { transcodeArtifactForExport } from "@ether/application";

const SOURCE_IMAGE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#ff3366"/></svg>',
  "utf8"
);

describe("artifact export codec", () => {
  it("preserves Original bytes exactly", async () => {
    const output = await transcodeArtifactForExport(SOURCE_IMAGE, "image/svg+xml", "original");
    expect(output.equals(SOURCE_IMAGE)).toBe(true);
  });

  it("writes real PNG, JPEG, and WebP bytes", async () => {
    const png = await transcodeArtifactForExport(SOURCE_IMAGE, "image/svg+xml", "png");
    const jpeg = await transcodeArtifactForExport(SOURCE_IMAGE, "image/svg+xml", "jpeg");
    const webp = await transcodeArtifactForExport(SOURCE_IMAGE, "image/svg+xml", "webp");

    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(jpeg.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(webp.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(webp.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("rejects converted formats for non-image artifacts", async () => {
    await expect(transcodeArtifactForExport(Buffer.from("hello"), "text/plain", "webp"))
      .rejects.toMatchObject({ code: "EXPORT_FORMAT_NOT_IMAGE" });
  });
});
