import { z } from 'zod';

export const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !s.includes('\0'), 'Path contains NUL byte');

export const userIdSchema = z.string().min(1).max(64);

export const approveUserSchema = z.object({
  userId: userIdSchema,
});

export const setRoleSchema = z.object({
  userId: userIdSchema,
  role: z.enum(['OWNER', 'ADMIN']),
});

export const setStatusSchema = z.object({
  userId: userIdSchema,
  status: z.enum(['PENDING', 'APPROVED', 'DISABLED']),
});

export const fileWriteSchema = z.object({
  path: pathSchema,
  content: z.string().max(10 * 1024 * 1024),
});

export const fileRenameSchema = z.object({
  from: pathSchema,
  to: pathSchema,
});

export const fileCreateSchema = z.object({
  path: pathSchema,
  type: z.enum(['file', 'folder']),
});

export const settingsUpdateSchema = z.object({
  admin_can_approve_users: z.boolean().optional(),
  allow_dotenv_access: z.boolean().optional(),
  terminal_enabled: z.boolean().optional(),
  terminal_audit_commands: z.boolean().optional(),
});
