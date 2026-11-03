import { z } from "zod";

/** A GitHub repository pinned to the commit the run reads from. */
export const RepoRefSchema = z.strictObject({
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
  // GitHub URLs are built from this name, so "." and ".." must not get through.
  repo: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,100}$/)
    .refine((name) => name !== "." && name !== "..", { message: "Invalid repository name" }),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
});

export type RepoRef = z.infer<typeof RepoRefSchema>;
