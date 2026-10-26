
import { z } from "zod";

export const UserRoleSchema = z.enum(["admin", "member"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const ServerTransportSchema = z.literal("streamable_http");
export type ServerTransport = z.infer<typeof ServerTransportSchema>;

export const UpstreamServerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  transport: ServerTransportSchema,
  endpoint_url: z.string().url(),
  is_enabled: z.boolean(),
  timeout_ms: z.number().int().min(100).max(120000),
});

export type UpstreamServer = z.infer<typeof UpstreamServerSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthResponseSchema = z.object({
  status: z.string(),
  service: z.string(),
  timestamp: z.string().optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
