import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const solverPort = Number(process.env.SOLVER_PORT ?? 8008);
if (!Number.isInteger(solverPort) || solverPort < 1024 || solverPort > 65535) throw new Error("Invalid SOLVER_PORT");
// The solver is part of this deployment. Never route calculations through the
// public edge of a second free service (which can return 429 before Python).
process.env.SOLVER_URL = `http://127.0.0.1:${solverPort}`;
process.env.NODE_ENV = "production";
const children = new Set();
let stopping = false, exitCode = 0;

function stop(code) {
  if (stopping) return;
  stopping = true; exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  if (!children.size) process.exit(exitCode);
  const timer = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); process.exit(exitCode); }, 10000);
  timer.unref();
}

function start(command, args) {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  children.add(child);
  child.on("error", error => { console.error(`Service startup failed: ${error.message}`); stop(1); });
  child.on("exit", code => {
    children.delete(child);
    if (!stopping) { console.error(`Service exited unexpectedly (${code})`); stop(code || 1); }
    else if (!children.size) process.exit(exitCode);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
start(process.env.PYTHON_EXECUTABLE ?? "python3", ["-m", "uvicorn", "solver_service.app:app", "--host", "127.0.0.1", "--port", String(solverPort)]);
try {
  let ready = false;
  const deadline = Date.now() + 60000;
  while (!ready && Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(`${process.env.SOLVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
      const value = await response.json();
      ready = response.ok && value.status === "ok" && value.solver === "ortools";
    } catch { /* Python may still be importing OR-Tools. */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Embedded OR-Tools did not become ready");
  if (!stopping) start(process.execPath, ["node_modules/vinext/dist/cli.js", "start", "--hostname", "0.0.0.0"]);
} catch (error) { console.error(error.message); stop(1); }
