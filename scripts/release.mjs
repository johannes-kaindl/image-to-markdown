// scripts/release.mjs
// Ein-Befehl-Release (PROF-OBS-09): bump → changelog → commit → tag → push (Codeberg) →
// build → Codeberg-Release. Das GitHub-Release entsteht eigenständig über den Mirror→Action.
//   npm run release 0.8.0               # vollständiger Release
//   npm run release -- 0.8.0 --dry-run  # nur loggen, nichts schreiben/pushen
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCodebergRelease } from "./lib/codeberg-release.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("-"));

function die(msg) { console.error(`release: ${msg}`); process.exit(1); }
function sh(cmd, cmdArgs) { return execFileSync(cmd, cmdArgs, { encoding: "utf8" }).trim(); }
function run(cmd, cmdArgs) {
  if (dryRun) { console.log(`[dry-run] ${cmd} ${cmdArgs.join(" ")}`); return; }
  execFileSync(cmd, cmdArgs, { stdio: "inherit" });
}

// 1. Guards.
if (!target || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(target)) {
  die("gültige Ziel-Version erwartet — z.B. `npm run release 0.8.0`.");
}
const tokenPath = join(homedir(), ".codeberg-token");
if (!existsSync(tokenPath)) die("~/.codeberg-token fehlt.");
const tagExists = sh("git", ["tag", "--list", target]) === target;
if (!tagExists && !dryRun && sh("git", ["status", "--porcelain"]) !== "") {
  die("Arbeitsbaum nicht sauber — committe oder stashe erst.");
}

// Release nur vom Default-Branch — `git push origin HEAD` (Schritt 6) würde sonst den falschen
// Branch pushen. Schützt nur den Full-Release-Pfad (Push); im Dry-Run/Resume übersprungen.
const currentBranch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
let defaultBranch;
try {
  defaultBranch = sh("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"]).replace(/^origin\//, "");
} catch {
  defaultBranch = "main"; // origin/HEAD nicht gesetzt → Annahme main
}
if (!tagExists && !dryRun && currentBranch !== defaultBranch) {
  die(`Release nur vom Default-Branch „${defaultBranch}" — aktuell „${currentBranch}".`);
}

// origin → "owner/name" (Codeberg) parsen.
const originUrl = sh("git", ["remote", "get-url", "origin"]);
const repoMatch = originUrl.match(/codeberg\.org[/:]([^/]+)\/(.+?)(?:\.git)?$/);
if (!repoMatch) die(`origin ist kein Codeberg-Remote: ${originUrl}`);
const repo = `${repoMatch[1]}/${repoMatch[2]}`;

// 2.–6. Nur wenn der Tag noch nicht existiert; sonst Resume (direkt Build + Codeberg-Release).
if (!tagExists) {
  run("node", ["scripts/version-bump.mjs", target]);          // 2. 3-File-Bump
  rewriteChangelog(target);                                    // 3. CHANGELOG
  run("git", ["add", "package.json", "manifest.json", "versions.json", "CHANGELOG.md"]); // 4. stage
  run("git", ["commit", "-m", `chore(release): ${target}`]);  //    commit (kein Trailer)
  run("git", ["tag", "-a", target, "-m", target]);            // 5. annotierter Tag
  run("git", ["push", "origin", "HEAD", "--follow-tags"]);    // 6. Push nach Codeberg
} else {
  console.log(`release: Tag ${target} existiert bereits → Resume (nur Build + Codeberg-Release).`);
}

// 7. Build.
run("npm", ["run", "build"]);

// 8. Codeberg-Release.
const notes = changelogSection(target);
const assets = ["main.js", "manifest.json", "styles.css"]
  .filter((f) => existsSync(f))
  .map((name) => ({ name, body: readFileSync(name) }));
if (dryRun) {
  console.log(`[dry-run] Codeberg-Release ${repo} ${target} mit Assets: ${assets.map((a) => a.name).join(", ")}`);
} else {
  const token = readFileSync(tokenPath, "utf8").trim();
  const out = await createCodebergRelease({ fetch, token, repo, tag: target, notes, assets });
  console.log(`release: Codeberg-Release ${out.htmlUrl}`);
}
console.log(`release: ${target} fertig. GitHub-Release folgt automatisch via Mirror→Action.`);

// --- Helfer ---
function rewriteChangelog(version) {
  const path = "CHANGELOG.md";
  const date = new Date().toISOString().slice(0, 10);
  const raw = readFileSync(path, "utf8");
  if (!/##\s*\[Unreleased\]/i.test(raw)) die("CHANGELOG.md hat keinen `## [Unreleased]`-Block.");
  // Fügt die neue Versions-Überschrift direkt nach [Unreleased] ein → der bisherige Unreleased-Inhalt
  // rutscht unter [version], [Unreleased] bleibt leer.
  const next = raw.replace(/##\s*\[Unreleased\]/i, `## [Unreleased]\n\n## [${version}] — ${date}`);
  if (dryRun) { console.log(`[dry-run] CHANGELOG: [Unreleased] → [${version}] — ${date}`); return; }
  writeFileSync(path, next);
}
function changelogSection(version) {
  if (!existsSync("CHANGELOG.md")) return `Release ${version}`;
  const raw = readFileSync("CHANGELOG.md", "utf8");
  const re = new RegExp(`##\\s*\\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s*\\[|$)`);
  const m = raw.match(re);
  return m ? m[1].trim() || `Release ${version}` : `Release ${version}`;
}
