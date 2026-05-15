// SQLite has no enums; keep these unions as the single source of truth
// and re-export them so the rest of the codebase imports from one place.

export type Role = 'OWNER' | 'ADMIN';
export type UserStatus = 'PENDING' | 'APPROVED' | 'DISABLED';

export const ROLES: readonly Role[] = ['OWNER', 'ADMIN'] as const;
export const STATUSES: readonly UserStatus[] = ['PENDING', 'APPROVED', 'DISABLED'] as const;
