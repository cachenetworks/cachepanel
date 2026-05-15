import { z } from 'zod';

export const serverCreateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]?$/, 'lowercase letters, digits, _ and -; start/end with alnum'),
  hostname: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).optional(),
  defaultUser: z.string().min(1).max(64),
  keyName: z.string().min(1).max(255).optional(),
  knownHostsName: z.string().min(1).max(255).optional(),
  tags: z.string().max(255).optional(),
  notes: z.string().max(1024).optional(),
});

export const serverUpdateSchema = serverCreateSchema.partial();
