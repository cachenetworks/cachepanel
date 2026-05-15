import { z } from 'zod';

export const driverEnum = z.enum(['mysql', 'mariadb', 'postgres', 'sqlite']);

export const profileCreateSchema = z.object({
  name: z.string().min(1).max(80),
  driver: driverEnum,
  host: z.string().max(255).optional(),
  port: z.number().int().min(0).max(65535).optional(),
  username: z.string().max(255).optional(),
  password: z.string().max(2048).optional(),
  database: z.string().max(1024).optional(),
  ssl: z.boolean().optional(),
  ownerOnly: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

export const profileUpdateSchema = profileCreateSchema.partial();

export const querySchema = z.object({
  sql: z.string().min(1).max(50_000),
  database: z.string().max(255).optional(),
});
