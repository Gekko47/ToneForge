import { z } from "zod";

export const ReviewOperationSchema = z.enum([
  "spot_selection",
  "spot_paragraph",
  "document_editorial_review",
  "future_document_consistency_review",
]);

export const ReviewRequestSchema = z
  .object({
    id: z.string().uuid(),
    operation: ReviewOperationSchema,
    documentId: z.string().trim().min(1),
    documentVersion: z.string().trim().min(1),
    targetNodeIds: z.array(z.string().trim().min(1)).default([]),
    text: z.string(),
    surroundingContext: z.string().optional(),
    profileId: z.string().uuid(),
    profileVersion: z.string().trim().min(1),
    privacyPolicyId: z.string().trim().min(1),
  })
  .superRefine((request, ctx) => {
    if (request.operation === "future_document_consistency_review") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operation"],
        message: "future_document_consistency_review is reserved for Phase H and is not enabled",
      });
    }
  });

export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type ReviewOperation = z.infer<typeof ReviewOperationSchema>;
