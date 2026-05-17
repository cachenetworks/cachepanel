import type { NextAuthOptions, Session } from 'next-auth';
import DiscordProvider from 'next-auth/providers/discord';
import { prisma } from './prisma';
import { getEnv, getAllowedRoles, getAllowedUserIds } from './env';
import { readSnapshot } from './config-snapshot';
import { audit } from './audit';
import { emitAlert } from './alerts';

// Discord creds + guild restriction now live in AppSetting (v1.7 setup
// wizard) with .env as a legacy fallback. These tiny helpers keep the
// rest of the file readable.
function discordClientId(): string { return readSnapshot('discord_client_id', process.env.DISCORD_CLIENT_ID ?? ''); }
function discordClientSecret(): string { return readSnapshot('discord_client_secret', process.env.DISCORD_CLIENT_SECRET ?? ''); }
function discordGuildId(): string { return readSnapshot('discord_guild_id', process.env.DISCORD_GUILD_ID ?? ''); }

const DISCORD_SCOPES = ['identify', 'email', 'guilds', 'guilds.members.read'];

interface DiscordGuildMember {
  roles?: string[];
}

async function checkGuildMembership(accessToken: string): Promise<{ ok: true; roles: string[] } | { ok: false; reason: string }> {
  const guildId = discordGuildId();
  if (!guildId) return { ok: true, roles: [] };
  try {
    const res = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) return { ok: false, reason: 'You are not a member of the required Discord guild.' };
    if (!res.ok) return { ok: false, reason: 'Could not verify Discord guild membership.' };
    const member = (await res.json()) as DiscordGuildMember;
    return { ok: true, roles: member.roles ?? [] };
  } catch {
    return { ok: false, reason: 'Discord guild check failed.' };
  }
}

function buildOptions(): NextAuthOptions {
  const env = getEnv();
  const isHttps = env.NEXTAUTH_URL.startsWith('https://');
  return {
    secret: env.NEXTAUTH_SECRET,
    session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },
    // Trust the X-Forwarded-* headers from Cloudflare / Nginx so the callback
    // host matches the NEXTAUTH_URL we configured.
    useSecureCookies: isHttps,
    pages: {
      signIn: '/login',
      error: '/login',
    },
    cookies: {
      sessionToken: {
        name: isHttps ? '__Secure-cachepanel.session' : 'cachepanel.session',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: isHttps,
        },
      },
      callbackUrl: {
        name: isHttps ? '__Secure-cachepanel.callback-url' : 'cachepanel.callback-url',
        options: { sameSite: 'lax', path: '/', secure: isHttps },
      },
      csrfToken: {
        name: isHttps ? '__Host-cachepanel.csrf-token' : 'cachepanel.csrf-token',
        options: { httpOnly: true, sameSite: 'lax', path: '/', secure: isHttps },
      },
    },
    providers: [
      DiscordProvider({
        clientId: discordClientId(),
        clientSecret: discordClientSecret(),
        authorization: { params: { scope: DISCORD_SCOPES.join(' ') } },
      }),
    ],
    callbacks: {
      async signIn({ user, account, profile }) {
        if (account?.provider !== 'discord' || !account.access_token) return false;
        const env = getEnv();
        const discordId = (profile as { id?: string })?.id ?? (user.id as string | undefined);
        if (!discordId) return false;

        // Optional user ID allowlist. If set, this is the strictest gate —
        // anyone not on the list is rejected before we hit Discord again.
        const allowedUserIds = getAllowedUserIds();
        if (allowedUserIds.length > 0 && !allowedUserIds.includes(discordId)) {
          await audit({
            action: 'login.failed',
            target: discordId,
            metadata: { reason: 'not on DISCORD_ALLOWED_USER_IDS allowlist', username: user.name },
          });
          return `/login?error=${encodeURIComponent('Your Discord account is not on the allowlist.')}`;
        }

        // Optional guild check
        const allowedRoles = getAllowedRoles();
        let guildRoles: string[] = [];
        if (discordGuildId()) {
          const check = await checkGuildMembership(account.access_token);
          if (!check.ok) {
            await audit({
              action: 'login.failed',
              target: discordId,
              metadata: { reason: check.reason, username: user.name },
            });
            return `/login?error=${encodeURIComponent(check.reason)}`;
          }
          guildRoles = check.roles;
          if (allowedRoles.length > 0) {
            const has = guildRoles.some((r) => allowedRoles.includes(r));
            if (!has) {
              await audit({
                action: 'login.failed',
                target: discordId,
                metadata: { reason: 'missing required Discord role', username: user.name },
              });
              return `/login?error=${encodeURIComponent('You do not have the required Discord role.')}`;
            }
          }
        } else if (allowedRoles.length > 0) {
          // Role check requires a guild — fail closed.
          await audit({
            action: 'login.failed',
            target: discordId,
            metadata: { reason: 'role check requires DISCORD_GUILD_ID' },
          });
          return `/login?error=${encodeURIComponent('Server misconfigured: role check requires DISCORD_GUILD_ID.')}`;
        }

        const username = (profile as { username?: string })?.username ?? user.name ?? 'unknown';
        const avatarHash = (profile as { avatar?: string | null })?.avatar ?? null;
        const avatarUrl = avatarHash
          ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`
          : null;

        // First successful login becomes OWNER, others become PENDING/ADMIN.
        const existingCount = await prisma.user.count();
        const existing = await prisma.user.findUnique({ where: { discordId } });

        if (existing) {
          if (existing.status === 'DISABLED') {
            await audit({
              userId: existing.id,
              action: 'login.failed',
              target: discordId,
              metadata: { reason: 'account disabled' },
            });
            return `/login?error=${encodeURIComponent('Your account has been disabled.')}`;
          }
          await prisma.user.update({
            where: { id: existing.id },
            data: {
              username,
              avatar: avatarUrl,
              email: user.email ?? existing.email,
              lastLoginAt: new Date(),
            },
          });
          await audit({
            userId: existing.id,
            action: 'login.success',
            target: discordId,
            metadata: { username },
          });
          void emitAlert('login.success', {
            description: `**${username}** logged in.`,
            fields: [{ name: 'Role', value: existing.role, inline: true }],
          });
          return true;
        }

        if (existingCount === 0) {
          const created = await prisma.user.create({
            data: {
              discordId,
              username,
              avatar: avatarUrl,
              email: user.email ?? null,
              role: 'OWNER',
              status: 'APPROVED',
              lastLoginAt: new Date(),
            },
          });
          await audit({
            userId: created.id,
            action: 'login.success',
            target: discordId,
            metadata: { username, bootstrap: true },
          });
          void emitAlert('login.success', {
            description: `**${username}** is the first user — promoted to OWNER.`,
            fields: [{ name: 'Role', value: 'OWNER (bootstrap)', inline: true }],
          });
          return true;
        }

        const created = await prisma.user.create({
          data: {
            discordId,
            username,
            avatar: avatarUrl,
            email: user.email ?? null,
            role: 'ADMIN',
            status: 'PENDING',
            lastLoginAt: new Date(),
          },
        });
        await audit({
          userId: created.id,
          action: 'user.pending_created',
          target: discordId,
          metadata: { username },
        });
        await audit({
          userId: created.id,
          action: 'login.success',
          target: discordId,
          metadata: { username, pending: true },
        });
        return true;
      },

      async jwt({ token, user, profile }) {
        if (user || profile) {
          const discordId =
            (profile as { id?: string } | undefined)?.id ??
            (user as { id?: string } | undefined)?.id;
          if (discordId) {
            token.discordId = discordId;
          }
        }
        if (token.discordId) {
          const db = await prisma.user.findUnique({ where: { discordId: token.discordId as string } });
          if (db) {
            token.uid = db.id;
            token.role = db.role as 'OWNER' | 'ADMIN';
            token.status = db.status as 'PENDING' | 'APPROVED' | 'DISABLED';
            token.username = db.username;
            token.avatar = db.avatar;
          }
        }
        return token;
      },

      async session({ session, token }) {
        const s = session as Session & {
          user: {
            id?: string;
            discordId?: string;
            role?: 'OWNER' | 'ADMIN';
            status?: 'PENDING' | 'APPROVED' | 'DISABLED';
            avatar?: string | null;
            username?: string;
          };
        };
        if (token.uid) s.user.id = token.uid as string;
        if (token.discordId) s.user.discordId = token.discordId as string;
        if (token.role) s.user.role = token.role as 'OWNER' | 'ADMIN';
        if (token.status) s.user.status = token.status as 'PENDING' | 'APPROVED' | 'DISABLED';
        if (token.username) s.user.username = token.username as string;
        if ('avatar' in token) s.user.avatar = (token.avatar as string | null) ?? null;
        return s;
      },
    },
    events: {
      async signOut({ token }) {
        if (token?.uid) {
          await audit({
            userId: token.uid as string,
            action: 'login.success',
            target: 'signout',
            metadata: { event: 'signout' },
          }).catch(() => undefined);
        }
      },
    },
  };
}

// Lazy singleton: defer reading env vars until the first runtime call.
// `next build` prerenders nothing that touches this (every page that calls
// getServerSession is `force-dynamic`), so the env check only fires at request
// time when real env vars exist.
let _cached: NextAuthOptions | null = null;
export function getAuthOptions(): NextAuthOptions {
  if (!_cached) _cached = buildOptions();
  return _cached;
}

// Kept for compatibility — but use getAuthOptions() in route handlers so the
// env check fires lazily at request time, not at build time.
export const authOptions: NextAuthOptions = new Proxy({} as NextAuthOptions, {
  get(_t, prop) {
    const opts = getAuthOptions() as unknown as Record<string | symbol, unknown>;
    return opts[prop as string];
  },
  ownKeys() {
    return Reflect.ownKeys(getAuthOptions() as unknown as object);
  },
  getOwnPropertyDescriptor(_t, prop) {
    return Object.getOwnPropertyDescriptor(getAuthOptions(), prop);
  },
});
