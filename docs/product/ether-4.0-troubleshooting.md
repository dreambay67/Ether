# Ether 4.0 Troubleshooting

**Applies to Ether 4.0.0 on Windows.** Keep the original `.ether` file unchanged while diagnosing. Ether 4.0 does not support or modify legacy folder projects.

| Symptom | What to do | Do not do |
|---|---|---|
| Codex is unavailable | Check the released Provider Health evidence where supplied and the Image/Worker Inspector. Confirm the installed Codex runtime is authenticated, then refresh/probe. | Add API credentials expecting a hidden fallback; Ether 4.0 has no selected paid-API fallback. |
| Gemini API is not connected or says protected storage is unavailable | Open **Settings > Gemini API**, or close Ether and launch `Ether.exe --connect-gemini` to open only the protected connector. Use Connect or Replace only in its password field. On a configured key, use Test; it verifies access without generating an image. If protected storage is unavailable or the record is corrupt, Remove/Replace after Windows protection is available. | Put the key after `--connect-gemini`, or paste it into a prompt, terminal command, document, diagnostics, environment variable, or support evidence. Ether fails closed and never uses a plaintext fallback. |
| A maximized or full-screen window leaves the workspace in the upper-left corner | Install the corrected build and resize, restore, maximize, or toggle full screen again. The root and workspace should follow the Windows content area continuously. | Treat a maximized native frame with a fixed-size upper-left workspace as expected behavior. |
| Gemini API reports authentication, billing, quota, safety, network, server, timeout, or malformed-output failure | Read the redacted error code in Job Center, fix that specific condition, then manually Retry only if no ambiguous output was accepted. Confirm Provider Health still says Gemini Developer API; check the selected model/ratio/size/reference profile. | Assume Ether generated an artifact, retry an ambiguous completed call automatically, or expect an Antigravity fallback. Ether never changes provider after an API error. |
| Antigravity unavailable | Set the official Antigravity **AI Credit Overages** option to **Never**, then check **Settings > Antigravity safety > I confirmed AI Credit Overages is set to Never in Antigravity**. Check Provider Health and confirm that `agy.exe --print` can reuse the machine's existing session. Ordinary Ether generation is noninteractive and must not open an authentication window. Run the capability probe after a CLI version or executable-hash change. | Check the Ether box before changing the official billing setting, treat the box as a bypass for CLI/version/profile conformance, or paste OAuth codes into Ether. |
| Antigravity offers no 2K or 4K choice | CLI 1.1.7 exposes aspect ratio but no output-size parameter. Ether shows only each ratio's conformed 1K dimensions. Install a future supported CLI and rerun conformance before expecting new sizes. | Assume descriptive prompt text changes the structural image size, or call a 1K result 2K/4K. |
| Antigravity says image quota is exhausted | Wait for the subscription quota window to reset, then Retry the failed work. Ether records a failure and does not create an artifact or enable credit overages. | Recheck the overage confirmation to bypass the provider quota, or treat a text-only CLI response as an image. |
| A connection is blocked | Select the endpoints and read the validation reason. Use one of Ether's declared adapters or a node function such as Image Generator or Mask. | Force a Text -> Image edge or assume a role converts a channel. |
| A job failed | Open Job Center > job detail. Read attempt state, correlation ID, provider category, and suggested action. Fix credentials/capability/input, then Retry. | Treat printed provider prose as successful output or reuse a changed plan. |
| Cancellation remains pending | Keep Job Center open. Ether cancels queued items; an active process transitions when its provider supports interruption. After an unexpected restart, reopen the document and let Ether recover interrupted queued work. | Expect a Resume button on a terminal job. Use Retry only for failed work. |
| A batch allocation or concurrency result is unexpected | Open Batch Matrix. Check **Full batch** for exact item count and exclusions, **Provider and model allocation** for each exact assigned count, and **Concurrent run** for requested versus effective concurrency. Preview the plan and inspect the effective prompts for injected dimension values. | Assume batch size equals concurrency or that each batch receives a separate allowance. Ether shares 8 active calls globally, 4 across Codex, 4 across Gemini API, and a separate 4 only for explicit Antigravity fallback; fifth same-family and ninth global calls wait, while unknown providers remain at 1. |
| A linked reference is missing | Use Locate, Search Folder, Relink All, Use Embedded Preview, Embed Available Copy, or Remove. | Assume the preview is the original source. |
| The document is read-only | Another writer, a network/cloud restriction, future format, or recoverable corruption may be responsible. Inspect/export safely; close the other writer or Repair to a new document. | Copy a lock/recovery file beside the document; Ether owns this state in AppData. |
| Recovery appears on open | Review the recovered revision and its changes before retaining it. | Assume recovery was silently applied. |
| Repair is offered | Save the repair result under a new `.ether` name and inspect its report/artifacts. | Overwrite the damaged source; repair is intentionally non-destructive. |
| An export or Live Output task fails | Regrant/choose the destination, check collision policy, then retry/reconcile. Rebuild the mirror if needed. | Delete embedded artifacts to clear an external mirror failure. |
| A legacy project folder was selected | Create/open a real `.ether` document instead; preserve the legacy directory separately. | Look for an importer or migration control; none exists in 4.0. |

## Recovery triage

```text
Open document
  -> normal: verify Saved state and continue
  -> read-only/recovery: review reason
       -> linked reference issue: relink or embed an available copy
       -> incomplete import/provider staging: review reconciliation/quarantine result
       -> metadata/index issue: use read-only recovery, then Repair to a new file
       -> another writer: close that writer, then reopen writable
```

If the app closes unexpectedly during autosave, import, Save As, Compact, or provider output import, reopen the original document first. Ether restores only complete transactions; partial media stays hidden or is reclaimed/quarantined. A failed Save As/Compact should leave the original and any pre-existing destination intact.

## Information to capture for support

Record the app version (4.0.0), document mode, exact visible error, correlation ID, provider/version/profile, plan ID/content hash, job/work-item/attempt ID, and a redacted diagnostic excerpt. Do not send the document, media, credentials, session tokens, or raw unredacted provider logs unless you have chosen a secure support channel.
