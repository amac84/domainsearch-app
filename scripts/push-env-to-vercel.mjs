/**
 * Push variables from a local .env file to Vercel using the Vercel CLI.
 *
 * Prerequisites:
 *   - Logged in: `npx vercel login`
 *   - Linked project: `npx vercel link` (from domainsearch-app/)
 *
 * Usage:
 *   node scripts/push-env-to-vercel.mjs
 *   node scripts/push-env-to-vercel.mjs --file .env --env production
 *   node scripts/push-env-to-vercel.mjs --all --dry-run
 *
 * Options:
 *   --file <path>     Env file (default: .env)
 *   --env <name>      production | preview | development (default: production)
 *   --all             Push to production, preview, and development
 *   --dry-run         Print what would be sent (no secrets printed in full)
 *   --force           Pass --force to `vercel env add` (overwrite existing)
 *   --sensitive-all   Mark every variable as --sensitive (default: heuristics for KEY/SECRET/TOKEN/PASSWORD)
 *   --cwd <dir>       App root (default: parent of scripts/)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const opts = {
    file: ".env",
    env: "production",
    all: false,
    dryRun: false,
    force: true,
    sensitiveAll: false,
    cwd: APP_ROOT,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" && argv[i + 1]) {
      opts.file = argv[++i];
    } else if (a === "--env" && argv[i + 1]) {
      opts.env = argv[++i];
    } else if (a === "--cwd" && argv[i + 1]) {
      opts.cwd = path.resolve(argv[++i]);
    } else if (a === "--all") {
      opts.all = true;
    } else if (a === "--dry-run") {
      opts.dryRun = true;
    } else if (a === "--no-force") {
      opts.force = false;
    } else if (a === "--force") {
      opts.force = true;
    } else if (a === "--sensitive-all") {
      opts.sensitiveAll = true;
    } else if (a === "-h" || a === "--help") {
      opts.help = true;
    }
  }
  return opts;
}

/** Parse .env: first `=` splits key/value; unquoted values keep `#` inside the value. */
function parseDotEnv(content) {
  const entries = [];
  const lines = content.split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1);
    if (!key) continue;
    // Strip surrounding quotes (basic support)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
    entries.push({ key, value });
  }
  return entries;
}

function looksSensitive(key) {
  const k = key.toUpperCase();
  return (
    k.includes("SECRET") ||
    k.includes("PASSWORD") ||
    k.includes("TOKEN") ||
    k.includes("API_KEY") ||
    k.endsWith("_KEY") ||
    k.includes("PRIVATE")
  );
}

function runVercelEnvAdd({ cwd, key, vercelEnv, value, force, sensitive }) {
  return new Promise((resolve, reject) => {
    // Windows: spawn EINVAL without shell when invoking npx/.cmd (Node security / path resolution).
    const args = [
      "--yes",
      "vercel@latest",
      "env",
      "add",
      key,
      vercelEnv,
      "--yes",
    ];
    if (force) args.push("--force");
    if (sensitive) args.push("--sensitive");

    const child = spawn("npx", args, {
      cwd,
      shell: true,
      stdio: ["pipe", "inherit", "inherit"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    child.stdin.write(value, "utf8");
    child.stdin.end();

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vercel env add exited with code ${code}`));
    });
  });
}

const USAGE = `
Push .env entries to Vercel (requires: vercel login + vercel link in app folder).

  node scripts/push-env-to-vercel.mjs [options]

Options:
  --file <path>      Default: .env
  --env <name>       production | preview | development (default: production)
  --all              Push to production, preview, and development
  --dry-run          List keys only (no values)
  --no-force         Do not overwrite existing Vercel vars
  --sensitive-all    Mark every var as sensitive on Vercel
  --cwd <dir>        App root (default: domainsearch-app/)
`;

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const envPath = path.isAbsolute(opts.file) ? opts.file : path.join(opts.cwd, opts.file);
  if (!fs.existsSync(envPath)) {
    console.error(`File not found: ${envPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(envPath, "utf8");
  const entries = parseDotEnv(content);
  if (entries.length === 0) {
    console.error("No KEY=value entries found in env file.");
    process.exit(1);
  }

  const targets = opts.all
    ? ["production", "preview", "development"]
    : [opts.env];

  for (const t of targets) {
    if (!["production", "preview", "development"].includes(t)) {
      console.error(`Invalid --env "${t}". Use production, preview, or development.`);
      process.exit(1);
    }
  }

  console.log(`Reading: ${envPath}`);
  console.log(`Target(s): ${targets.join(", ")}`);
  console.log(`Variables: ${entries.length}\n`);

  (async () => {
    for (const target of targets) {
      for (const { key, value } of entries) {
        const sensitive = opts.sensitiveAll || looksSensitive(key);
        if (opts.dryRun) {
          const hint = sensitive ? "(sensitive)" : "";
          console.log(
            `[dry-run] ${key} → ${target} ${hint} value length=${value.length}`,
          );
          continue;
        }
        try {
          await runVercelEnvAdd({
            cwd: opts.cwd,
            key,
            vercelEnv: target,
            value,
            force: opts.force,
            sensitive,
          });
          console.log(`OK ${key} (${target})`);
        } catch (e) {
          console.error(`FAIL ${key} (${target}): ${e.message}`);
          process.exitCode = 1;
        }
      }
    }
    if (opts.dryRun) {
      console.log("\nDry run only — no changes made. Run without --dry-run to push.");
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
