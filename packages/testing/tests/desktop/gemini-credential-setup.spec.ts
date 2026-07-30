import { expect, test } from "@playwright/test";

test("connects Gemini through the protected credential-only surface without opening a workspace", async ({ page }) => {
  await page.addInitScript(() => {
    let status: { state: "not-configured" | "configured"; verifiedAt: null } = {
      state: "not-configured",
      verifiedAt: null
    };
    Object.defineProperty(window, "ether", {
      value: {
        runtime: {
          rendererInteractive: async () => undefined,
          geminiCredentialStatus: async () => status,
          connectGeminiCredential: async (_apiKey: string) => {
            status = { state: "configured", verifiedAt: null };
            return status;
          },
          testGeminiCredential: async () => {
            const verified = { state: "verified" as const, verifiedAt: "2026-07-30T00:00:00.000Z" };
            return verified;
          },
          removeGeminiCredential: async () => {
            status = { state: "not-configured", verifiedAt: null };
            return status;
          }
        }
      }
    });
  });

  await page.goto("/?surface=gemini-connect", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Connect Gemini without opening a workspace" })).toBeVisible();
  await expect(page.getByTestId("document-canvas")).toHaveCount(0);

  const panel = page.getByTestId("gemini-api-settings");
  const field = panel.getByLabel("Gemini API key");
  await expect(field).toHaveAttribute("type", "password");
  await field.fill("inert-test-entry");
  await panel.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(field).toHaveValue("");
  await expect(panel).toContainText("Configured — test recommended");
  await panel.getByRole("button", { name: "Test", exact: true }).click();
  await expect(panel).toContainText("Verified");
  await expect(panel).not.toContainText("inert-test-entry");
});
