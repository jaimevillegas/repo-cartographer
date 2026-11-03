import { z } from "zod";

/** A GitHub repository pinned to the commit the run reads from. */
export const RepoRefSchema = z.strictObject({
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
  repo: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
});

export type RepoRef = z.infer<typeof RepoRefSchema>;
