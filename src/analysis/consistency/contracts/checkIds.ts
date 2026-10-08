import { z } from "zod";

/**
 * The ten check identities, as a runtime-validated contract.
 *
 * This lives in its own leaf module because both the request schema and the
 * check registry need it, and the registry already imports the request. Keeping
 * the enum here lets the request validate `checks` against the real ids without
 * a cycle back into the registry.
 */
export const ConsistencyCheckIdSchema = z.enum([
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
  "C8",
  "C9",
  "C10",
]);

/** The ten check ids, as the runtime-validated contract types them. */
export type ConsistencyCheckId = z.infer<typeof ConsistencyCheckIdSchema>;
