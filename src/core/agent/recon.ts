import type { Snapshot } from "../snapshot/snapshot";

const MAX_TREE_ENTRIES = 80;
const MAX_MANIFEST_PATHS = 40;
const MAX_SUMMARISED = 8;
const MAX_NAMES = 20;
const MAX_VALUE_CHARS = 100;
const MAX_MANIFEST_DEPTH = 3;

/** File names that say how a project is built, run or deployed. */
const MANIFEST_NAMES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "Chart.yaml",
  "Procfile",
  "vercel.json",
  "fly.toml",
]);

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const isCompose = (name: string) => /^(docker-compose.*|compose)\.ya?ml$/.test(name);

const isManifest = (path: string) => {
  const name = baseName(path);
  return MANIFEST_NAMES.has(name) || isCompose(name) || /^Dockerfile(\..+)?$/.test(name) || name.endsWith(".tf");
};

/** Repository text goes into the prompt, so keep it short and free of control characters. */
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_VALUE_CHARS);

const names = (value: unknown): string[] =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value).slice(0, MAX_NAMES).map(clean)
    : [];

function summarisePackageJson(path: string, text: string): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null) return undefined;
  const pkg = json as Record<string, unknown>;

  const parts = [`name: ${typeof pkg.name === "string" ? clean(pkg.name) : "(none)"}`];
  const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces as { packages?: unknown })?.packages;
  if (Array.isArray(workspaces)) parts.push(`workspaces: ${workspaces.slice(0, MAX_NAMES).map((w) => clean(String(w))).join(", ")}`);
  const scripts = names(pkg.scripts);
  if (scripts.length > 0) parts.push(`scripts: ${scripts.join(", ")}`);
  const dependencies = names(pkg.dependencies);
  if (dependencies.length > 0) parts.push(`dependencies: ${dependencies.join(", ")}`);
  return `- ${path}: ${parts.join("; ")}`;
}

/** Service names and images of a Compose file, found with a line scan instead of a YAML parser. */
function summariseCompose(path: string, text: string): string | undefined {
  const services: string[] = [];
  let inServices = false;
  let current: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) inServices = /^services:\s*$/.test(line);
    else if (inServices) {
      const service = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
      if (service) {
        current = clean(service[1]);
        services.push(current);
      } else if (current !== undefined) {
        const image = /^ {4}image:\s*["']?([^\s"']+)/.exec(line);
        if (image) services[services.length - 1] = `${current} (image ${clean(image[1])})`;
      }
    }
  }
  return services.length > 0 ? `- ${path}: services ${services.slice(0, MAX_NAMES).join(", ")}` : undefined;
}

/**
 * A deterministic first look at the repository: the top of the tree, the files that describe how
 * it is built and deployed, and a digest of the main ones. It costs no model call and gives the
 * agent a starting point so it does not spend its first steps on the obvious.
 *
 * All of this text comes from the repository, so the prompt presents it as data.
 */
export function buildRecon(snapshot: Snapshot): string {
  const sections: string[] = [];

  const tree = snapshot.list("", 2) ?? [];
  const shown = tree.slice(0, MAX_TREE_ENTRIES).map((e) => (e.type === "dir" ? `${clean(e.path)}/` : clean(e.path)));
  if (tree.length > shown.length) shown.push(`… ${tree.length - shown.length} more entries`);
  sections.push(`Top of the tree (${snapshot.fileCount} files in total):\n${shown.join("\n") || "(empty repository)"}`);

  const manifests = snapshot
    .files()
    .filter((file) => file.path.split("/").length <= MAX_MANIFEST_DEPTH + 1 && isManifest(file.path));
  if (manifests.length > 0) {
    const listed = manifests.slice(0, MAX_MANIFEST_PATHS).map((file) => `- ${clean(file.path)}`);
    if (manifests.length > listed.length) listed.push(`… ${manifests.length - listed.length} more`);
    sections.push(`Build, run and deploy files:\n${listed.join("\n")}`);
  }

  const digests: string[] = [];
  for (const file of manifests) {
    if (digests.length >= MAX_SUMMARISED || file.text === null) continue;
    const name = baseName(file.path);
    const digest =
      name === "package.json"
        ? summarisePackageJson(clean(file.path), file.text)
        : isCompose(name)
          ? summariseCompose(clean(file.path), file.text)
          : undefined;
    if (digest !== undefined) digests.push(digest);
  }
  if (digests.length > 0) sections.push(`Digest of the main files:\n${digests.join("\n")}`);

  return sections.join("\n\n");
}
