import type { RepoRef } from "../schema/repo";

/**
 * A file of the repository at the pinned commit. Content is kept only for text files of reasonable
 * size; binary and oversized files stay listed, with their size, so the tree is still complete.
 */
export type SnapshotFile = { path: string; size: number } & (
  | { text: string; omitted?: undefined }
  | { text: null; omitted: "binary" | "too_large" }
);

export type TreeEntry = { path: string; type: "dir" | "file"; size?: number };

/** Splits file content into lines. A trailing newline does not add an empty last line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 0));

/** The directories above a path, outermost first: `a/b/c.ts` gives `a` and `a/b`. */
function* ancestorsOf(path: string): Generator<string> {
  for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
    yield path.slice(0, i);
  }
}

type Directory = { dirs: Set<string>; files: Set<string> };

/** An immutable view of one repository at one commit. All the agent's tools read from it. */
export class Snapshot {
  private readonly lineCache = new Map<string, string[]>();

  constructor(
    readonly ref: RepoRef,
    private readonly fileMap: ReadonlyMap<string, SnapshotFile>,
    private readonly directories: ReadonlyMap<string, Directory>,
  ) {}

  get fileCount(): number {
    return this.fileMap.size;
  }

  file(path: string): SnapshotFile | undefined {
    return this.fileMap.get(path);
  }

  isDirectory(path: string): boolean {
    return this.directories.has(path);
  }

  /** Every file, sorted by path. */
  files(): SnapshotFile[] {
    return [...this.fileMap.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  /** Lines of a text file, or `undefined` when the file is missing, binary or too large. */
  lines(path: string): string[] | undefined {
    const file = this.fileMap.get(path);
    if (file === undefined || file.text === null) return undefined;
    let lines = this.lineCache.get(path);
    if (lines === undefined) {
      lines = splitLines(file.text);
      this.lineCache.set(path, lines);
    }
    return lines;
  }

  /**
   * The contents of a directory down to `depth` levels, depth first, with directories before files
   * at each level and names in alphabetical order. `undefined` when the path is not a directory.
   */
  list(dir = "", depth = 1): TreeEntry[] | undefined {
    if (!this.directories.has(dir)) return undefined;
    const entries: TreeEntry[] = [];
    const visit = (current: string, remaining: number) => {
      const directory = this.directories.get(current)!;
      for (const child of [...directory.dirs].sort()) {
        entries.push({ path: child, type: "dir" });
        if (remaining > 1) visit(child, remaining - 1);
      }
      for (const path of [...directory.files].sort()) {
        entries.push({ path, type: "file", size: this.fileMap.get(path)!.size });
      }
    };
    visit(dir, depth);
    return entries;
  }
}

/**
 * Collects files into a snapshot while keeping the tree consistent: a path cannot be both a file
 * and a directory, and the first file seen for a path wins. Archives are untrusted, so a file that
 * conflicts is dropped instead of corrupting the tree.
 */
export class SnapshotBuilder {
  private readonly fileMap = new Map<string, SnapshotFile>();
  private readonly directories = new Map<string, Directory>([["", { dirs: new Set(), files: new Set() }]]);

  /** Returns `false` when the file was dropped. */
  add(file: SnapshotFile): boolean {
    const { path } = file;
    if (this.fileMap.has(path) || this.directories.has(path)) return false;
    for (const ancestor of ancestorsOf(path)) {
      if (this.fileMap.has(ancestor)) return false;
    }

    for (const ancestor of ancestorsOf(path)) {
      if (!this.directories.has(ancestor)) {
        this.directories.set(ancestor, { dirs: new Set(), files: new Set() });
        this.directories.get(parentOf(ancestor))!.dirs.add(ancestor);
      }
    }
    this.directories.get(parentOf(path))!.files.add(path);
    this.fileMap.set(path, file);
    return true;
  }

  build(ref: RepoRef): Snapshot {
    return new Snapshot(ref, this.fileMap, this.directories);
  }
}
