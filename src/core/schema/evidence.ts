import { z } from "zod";

/** Evidence should point at the specific lines that support a claim, not at a whole file. */
export const MAX_EVIDENCE_LINES = 200;
export const MAX_EVIDENCE_PER_ITEM = 5;

const isSafeRelativePath = (path: string) =>
  !path.includes("\0") &&
  !path.includes("\\") &&
  !path.startsWith("/") &&
  path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

/** A path relative to the repository root, using forward slashes. */
export const RepoPathSchema = z
  .string()
  .min(1)
  .max(300)
  .refine(isSafeRelativePath, {
    message: "Must be a repo-relative POSIX path with no '.', '..' or empty segments",
  });

export const EvidenceSchema = z
  .strictObject({
    path: RepoPathSchema,
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
  })
  .refine((evidence) => evidence.endLine >= evidence.startLine, {
    message: "endLine must be greater than or equal to startLine",
    path: ["endLine"],
  })
  .refine((evidence) => evidence.endLine - evidence.startLine + 1 <= MAX_EVIDENCE_LINES, {
    message: `An evidence range can span at most ${MAX_EVIDENCE_LINES} lines`,
    path: ["endLine"],
  });

export const EvidenceListSchema = z.array(EvidenceSchema).min(1).max(MAX_EVIDENCE_PER_ITEM);

export type Evidence = z.infer<typeof EvidenceSchema>;
