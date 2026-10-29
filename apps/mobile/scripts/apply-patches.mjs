// Applies the dependency patches in ../patches to node_modules, so installs stay `--ignore-scripts`.
// Each file is `<package, "/" written as "+">@<exact version>.patch`, a unified diff (applied with `patch -p1`) relative
// to the package root. Re-running is safe; a patch whose package version changed fails loudly.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cwd, ...args) => execFileSync("patch", ["-p1", "--batch", "--forward", ...args], { cwd, stdio: "pipe", encoding: "utf8" });

for (const file of readdirSync(join(root, "patches")).filter((name) => name.endsWith(".patch")).sort()) {
  const match = /^(.+)@(\d[^@]*)\.patch$/.exec(file);
  if (!match) throw new Error(`Unrecognized patch name: ${file}`);
  const [, encoded, version] = match;
  const name = encoded.replaceAll("+", "/");
  const target = join(root, "node_modules", name);
  if (!existsSync(target)) throw new Error(`Patched package is not installed: ${name}`);
  const installed = JSON.parse(readFileSync(join(target, "package.json"), "utf8")).version;
  if (installed !== version) throw new Error(`${file} is for ${name}@${version}, but ${installed} is installed`);
  const patch = join(root, "patches", file);
  try { run(target, "--dry-run", "-i", patch); }
  catch (error) {
    // `--forward` refuses a patch that is already in place; that is the idempotent case.
    if (/previously applied/i.test(String(error.stdout))) { console.log(`already applied: ${file}`); continue; }
    throw error;
  }
  run(target, "-i", patch);
  console.log(`applied: ${file}`);
}
