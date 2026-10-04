import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CLI_VERSION = "2.118.0";
export const MIGRATIONS = [
  "20260928000100_initial_contract.sql",
  "20260928000200_controlled_reports.sql",
  "20260929000100_jd_drafts.sql",
  "20260929000200_confirmed_report_snapshot.sql",
  "20260930000100_fix_rpc_conflict_codes.sql",
  "20260930000200_analysis_runs.sql",
  "20261001000100_async_analysis_queue.sql",
  "20261002000100_expand_analysis_budget.sql",
];
export const MIGRATION_VERSIONS=Object.freeze(MIGRATIONS.map(name=>name.slice(0,14)));
// Review-only: deliberately NOT added to the generic apply allowlist.
export const REVIEW_ONLY_MIGRATIONS=Object.freeze(['20261004000100_evidence_plans_v2.sql']);

export function sessionPoolerTarget(value, ref) {
  const url = new URL(value.trim());
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("Invalid pooler protocol");
  if (url.password || url.username !== `postgres.${ref}` || !/^aws-\d+-ap-southeast-1\.pooler\.supabase\.com$/.test(url.hostname)
    || url.port !== "5432" || url.pathname !== "/postgres" || url.search || url.hash) throw new Error("Unexpected session pooler target");
  return url.href;
}

/** No credential value is returned, logged or placed in command-line arguments. */
export function migrationCommands(mode, env, linkedRef = "") {
  if (!["plan", "apply", "status"].includes(mode)) throw new Error("Use plan, apply or status.");
  const ref = env.SUPABASE_PROJECT_REF;
  if (!/^[a-z0-9]{20}$/.test(ref ?? "")) throw new Error("Set SUPABASE_PROJECT_REF locally.");
  let url;
  try { url = new URL(env.TEST_SUPABASE_URL); } catch { throw new Error("Set the test project URL locally."); }
  if (url.origin !== `https://${ref}.supabase.co` || url.username || url.password || url.search || url.hash
    || url.pathname !== "/" || url.host !== env.TEST_PROJECT_HOST) throw new Error("Project ref, test URL and host must match.");
  if (linkedRef && linkedRef !== ref) throw new Error("Existing CLI link points to another project; stop and review it.");
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_DB_PASSWORD) throw new Error("Configure CLI token and database password in the ignored local file.");
  if (mode === "apply" && env.ALLOW_DATABASE_MIGRATIONS !== "true") throw new Error("Apply requires ALLOW_DATABASE_MIGRATIONS=true in the ignored local file.");
  const commands = [["link", "--project-ref", ref], ["migration", "list", "--linked"]];
  if (mode !== "status") commands.push(["db", "push", "--linked", "--dry-run"]);
  if (mode === "apply") commands.push(["db", "push", "--linked", "--yes"], ["migration", "list", "--linked"]);
  return commands;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const mode = process.argv[2];
  let commands;
  try {
    const names = readdirSync(resolve(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
    if (JSON.stringify(names) !== JSON.stringify(MIGRATIONS)) throw new Error("Migration set differs from the reviewed files; review before applying.");
    const refPath = resolve(root, "supabase/.temp/project-ref");
    commands = migrationCommands(mode, process.env, existsSync(refPath) ? readFileSync(refPath, "utf8").trim() : "");
  } catch (error) {
    console.error(`未执行迁移：${error.message}`); process.exitCode = 2; return;
  }
  const logDir = resolve(root, ".supabase-test-logs", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(logDir, { recursive: true });
  for (const [index, args] of commands.entries()) {
    let commandArgs = args;
    const childEnv = { ...process.env };
    if (process.env.SUPABASE_USE_SESSION_POOLER === "true" && args.includes("--linked")) {
      const pooler = sessionPoolerTarget(readFileSync(resolve(root, "supabase/.temp/pooler-url"), "utf8"), process.env.SUPABASE_PROJECT_REF);
      commandArgs = args.flatMap((arg) => arg === "--linked" ? ["--db-url", pooler] : [arg]);
      childEnv.PGPASSWORD = process.env.SUPABASE_DB_PASSWORD;
    }
    // Fixed command tokens plus a validated alphanumeric ref. Secrets only travel via env.
    const tokens = ["--yes", `supabase@${CLI_VERSION}`, ...commandArgs];
    const result = process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npx ${tokens.join(" ")}`], { cwd: root, env: childEnv, encoding: "utf8", timeout: 300000, input: "" })
      : spawnSync("npx", tokens, { cwd: root, env: childEnv, encoding: "utf8", timeout: 300000, input: "" });
    // CLI diagnostics may contain connection details; keep ALL raw output in ignored local files.
    const log = resolve(logDir, `${index + 1}-${args[0]}-${args[1]}.log`);
    writeFileSync(log, (result.stdout ?? "") + (result.stderr ?? ""), { mode: 0o600 });
    if (result.status !== 0 || result.error) {
      console.error(`CLI step ${index + 1} failed; inspect local log: ${log}. Do not paste secrets or full logs into chat.`);
      process.exitCode = 1; return;
    }
    console.log(`PASS: ${args.slice(0, 2).join(" ")} (local log: ${log})`);
  }
  console.log(mode === "apply"
    ? "CLI push finished. Check migration-list log: all eight versions must appear in Local AND Remote. This is not RLS acceptance."
    : "CLI inspection finished. Review local logs; plan/status does not run SQL migrations.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
