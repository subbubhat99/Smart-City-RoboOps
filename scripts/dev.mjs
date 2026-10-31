import { spawn } from "node:child_process";

const children = [];
function launch(command, args, env = process.env) {
  const child = spawn(command, args, { stdio: "inherit", env });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    shutdown(1);
  });
  child.on("exit", (code) => {
    if (code !== null) shutdown(code);
  });
}
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => {
    if (process.platform === "win32" && child.pid && child.exitCode === null)
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    else child.kill();
  });
  process.exitCode = code;
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
launch("uv", [
  "run",
  "--no-project",
  "--directory",
  "backend",
  "--with-requirements",
  "requirements.txt",
  "uvicorn",
  "app.main:app",
  "--host",
  "127.0.0.1",
  "--port",
  "8000",
]);
// Invoke pnpm through its JS entry point to avoid Windows .cmd shell quoting.
launch(process.execPath, [
  process.env.npm_execpath,
  "--filter",
  "@workspace/smart-city-roboops",
  "run",
  "dev",
]);
