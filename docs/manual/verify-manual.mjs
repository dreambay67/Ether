import { execFileSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(root, "docs", "manual", "verify-manual.py");
execFileSync(process.env.PYTHON ?? "python", [script], { cwd: root, stdio: "inherit" });
