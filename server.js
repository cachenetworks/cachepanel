// CachePanel custom server: Next.js + socket.io + node-pty terminal bridge.
//
// We use a custom server (instead of pure App Router) because xterm.js needs a
// long-lived WebSocket connection to a node-pty child process, which Next's
// serverless route runtime cannot host. NextAuth session cookies are validated
// here before any pty is spawned.

const http = require('node:http');
const { parse } = require('node:url');
const next = require('next');
const { Server } = require('socket.io');
const { getToken } = require('next-auth/jwt');

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.APP_PORT || '8992', 10);
const hostname = '0.0.0.0';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// node-pty is loaded lazily so the rest of the server can still run if the
// native module fails to build (e.g. on Windows during dev — the user is
// expected to run the terminal under Docker / Linux).
let pty = null;
let ptyLoadError = null;
try {
  pty = require('node-pty');
} catch (err) {
  ptyLoadError = err;
  console.warn('[cachepanel] node-pty failed to load:', err && err.message);
}

const MAX_SESSIONS_PER_USER = 4;
const sessionsByUser = new Map(); // userId -> Set<socketId>

function envFlag(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return v === 'true';
}

function getTerminalConfig() {
  return {
    enabled: envFlag('TERMINAL_ENABLED', true),
    shell: process.env.TERMINAL_SHELL || '/bin/bash',
    user: process.env.TERMINAL_USER || '',
    startDir: process.env.TERMINAL_START_DIR || process.env.HOME || '/',
    auditCommands: envFlag('TERMINAL_AUDIT_COMMANDS', false),
    ssh: {
      host: process.env.SSH_HOST || '',
      port: process.env.SSH_PORT || '22',
      user: process.env.SSH_USER || '',
      keyPath: process.env.SSH_KEY_PATH || '',
      knownHosts: process.env.SSH_KNOWN_HOSTS || '',
    },
  };
}

async function attachAudit(prisma, payload) {
  if (!prisma) return;
  try {
    // SQLite stores `metadata` as a String column. Stringify objects before
    // handing them to Prisma so the call doesn't reject.
    const data = { ...payload };
    if (data.metadata && typeof data.metadata !== 'string') {
      try {
        data.metadata = JSON.stringify(data.metadata);
      } catch (_) {
        data.metadata = String(data.metadata);
      }
    }
    await prisma.auditLog.create({ data });
  } catch (err) {
    console.error('[cachepanel] audit write failed', err && err.message);
  }
}

let prismaSingleton = null;
function getPrisma() {
  if (prismaSingleton) return prismaSingleton;
  try {

    const { PrismaClient } = require('@prisma/client');
    prismaSingleton = new PrismaClient();
  } catch (err) {
    console.warn('[cachepanel] Prisma client not available:', err && err.message);
    prismaSingleton = null;
  }
  return prismaSingleton;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

(async () => {
  await app.prepare();

  const server = http.createServer((req, res) => {
    const parsed = parse(req.url, true);
    handle(req, res, parsed).catch((err) => {
      console.error('[next] request error', err);
      res.statusCode = 500;
      res.end('Internal server error');
    });
  });

  const io = new Server(server, {
    path: '/api/terminal/socket',
    cors: { origin: false },
    maxHttpBufferSize: 1024 * 64,
    pingInterval: 25_000,
    pingTimeout: 60_000,
  });

  // Auth: validate the NextAuth JWT from the upgrade request's cookies.
  io.use(async (socket, nextFn) => {
    try {
      const cfg = getTerminalConfig();
      if (!cfg.enabled) return nextFn(new Error('Terminal is disabled.'));
      if (!pty) return nextFn(new Error('Terminal backend unavailable: ' + (ptyLoadError ? ptyLoadError.message : 'node-pty missing')));

      // Parse the Cookie header manually — Socket.IO's upgrade request has the
      // raw header but no parsed `req.cookies`, which is what getToken() needs.
      const rawCookieHeader = socket.request.headers.cookie || '';
      const parsedCookies = {};
      for (const part of rawCookieHeader.split(/;\s*/)) {
        if (!part) continue;
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const k = part.slice(0, eq).trim();
        const v = decodeURIComponent(part.slice(eq + 1).trim());
        parsedCookies[k] = v;
      }

      // Prefer the forwarded scheme from Cloudflare/Nginx; fall back to NEXTAUTH_URL.
      const xfProto = socket.request.headers['x-forwarded-proto'];
      const proto = Array.isArray(xfProto) ? xfProto[0] : xfProto;
      const isHttps = proto
        ? proto.split(',')[0].trim() === 'https'
        : !!(process.env.NEXTAUTH_URL && process.env.NEXTAUTH_URL.startsWith('https://'));

      const cookieName = isHttps ? '__Secure-cachepanel.session' : 'cachepanel.session';

      const fakeReq = {
        headers: socket.request.headers,
        cookies: parsedCookies,
      };
      let token = await getToken({
        req: fakeReq,
        secret: process.env.NEXTAUTH_SECRET,
        cookieName,
        secureCookie: isHttps,
      });

      // Fallback: if the secure-cookie attempt failed but a session cookie is
      // present under either name, try the other name. Catches edge cases where
      // a stale cookie from a previous config is still floating around.
      if (!token) {
        const altName = isHttps ? 'cachepanel.session' : '__Secure-cachepanel.session';
        if (parsedCookies[altName]) {
          token = await getToken({
            req: fakeReq,
            secret: process.env.NEXTAUTH_SECRET,
            cookieName: altName,
            secureCookie: altName.startsWith('__Secure-'),
          });
        }
      }

      if (!token || !token.uid) {
        console.warn('[terminal] auth rejected: no token. cookies present:', Object.keys(parsedCookies));
        return nextFn(new Error('Unauthorized'));
      }
      if (token.status === 'DISABLED') return nextFn(new Error('Account disabled'));
      if (token.status === 'PENDING') return nextFn(new Error('Account pending approval'));
      if (token.role !== 'OWNER' && token.role !== 'ADMIN') return nextFn(new Error('Insufficient role'));

      socket.data.userId = token.uid;
      socket.data.role = token.role;
      socket.data.username = token.username || 'user';
      socket.data.ip = clientIp(socket.request);
      return nextFn();
    } catch (err) {
      console.error('[terminal] auth error', err);
      return nextFn(new Error('Auth failed'));
    }
  });

  io.on('connection', async (socket) => {
    const cfg = getTerminalConfig();
    const userId = socket.data.userId;

    // Enforce per-user session cap.
    const existing = sessionsByUser.get(userId) || new Set();
    if (existing.size >= MAX_SESSIONS_PER_USER) {
      socket.emit('terminal:error', `You already have ${MAX_SESSIONS_PER_USER} active terminal sessions.`);
      socket.disconnect(true);
      return;
    }
    existing.add(socket.id);
    sessionsByUser.set(userId, existing);

    // Multi-server: pick the target server from the WS handshake's ?server=
    // query, fall back to the primary. Then resolve the right SSH identity
    // for this (user, server) pair.
    const prismaForLookup = getPrisma();
    let serverRecord = null;
    let resolvedSpec = null;
    if (prismaForLookup) {
      try {
        const requestedServerId = (socket.handshake?.query?.server || '').toString();
        if (requestedServerId) {
          serverRecord = await prismaForLookup.server.findUnique({ where: { id: requestedServerId } });
        }
        if (!serverRecord) {
          serverRecord = await prismaForLookup.server.findFirst({ where: { isPrimary: true } });
        }
        if (serverRecord) {
          const path = require('node:path');
          const fs = require('node:fs');
          // Wizard-generated keys live in the writable mount; pre-baked keys
          // in the read-only one. Prefer the writable dir.
          const lookupSecret = (filename) => {
            const runtime = path.join(process.env.RUNTIME_SECRETS_DIR || '/run/secrets-servers', filename);
            if (fs.existsSync(runtime)) return runtime;
            return path.join(process.env.SECRETS_DIR || '/run/secrets', filename);
          };
          let user = serverRecord.defaultUser;
          let keyPath = lookupSecret(serverRecord.keyName);
          // Per-(user, server) provisioning: prefer that account + per-user key if present.
          const prov = await prismaForLookup.userServerProvision.findUnique({
            where: { userId_serverId: { userId, serverId: serverRecord.id } },
          });
          if (prov && prov.provisioned && prov.sshUsername) {
            const userKey = path.join(
              process.env.PER_USER_SECRETS_DIR || '/run/secrets-users',
              userId,
              'id_ed25519',
            );
            if (fs.existsSync(userKey)) {
              user = prov.sshUsername;
              keyPath = userKey;
            }
          } else {
            // Fall back to legacy single-server per-user table for the primary only.
            if (serverRecord.isPrimary) {
              const u = await prismaForLookup.user.findUnique({
                where: { id: userId },
                select: { sshAccess: true, sshUsername: true, sshProvisioned: true },
              });
              if (u && u.sshAccess && u.sshProvisioned && u.sshUsername) {
                const userKey = path.join(
                  process.env.PER_USER_SECRETS_DIR || '/run/secrets-users',
                  userId,
                  'id_ed25519',
                );
                if (fs.existsSync(userKey)) {
                  user = u.sshUsername;
                  keyPath = userKey;
                }
              }
            }
          }
          resolvedSpec = {
            host: serverRecord.hostname,
            port: serverRecord.port,
            user,
            keyPath,
            knownHosts: lookupSecret(serverRecord.knownHostsName),
          };
        }
      } catch (err) {
        console.warn('[terminal] could not resolve server', err && err.message);
      }
    }

    // Build PTY spawn options.
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    // Strip secrets from the inherited environment before handing to the shell.
    delete env.NEXTAUTH_SECRET;
    delete env.DISCORD_CLIENT_SECRET;
    delete env.DATABASE_URL;

    const spawnArgs = [];
    const spawnOptions = {
      name: 'xterm-color',
      cols: 100,
      rows: 32,
      cwd: cfg.startDir,
      env,
    };

    let shell;
    let shellArgs = spawnArgs;

    // SSH-to-host mode: connect to the real host via ssh. Use the resolved
    // server (multi-server) when available, fall back to the legacy SSH_*
    // env vars when no Server rows exist yet.
    const useSpec = resolvedSpec || (cfg.ssh.host ? {
      host: cfg.ssh.host,
      port: cfg.ssh.port,
      user: cfg.ssh.user,
      keyPath: cfg.ssh.keyPath,
      knownHosts: cfg.ssh.knownHosts,
    } : null);

    if (useSpec) {
      if (!useSpec.user) {
        socket.emit('terminal:error', 'No SSH user configured for this server.');
        socket.disconnect(true);
        return;
      }
      shell = '/usr/bin/ssh';
      shellArgs = [
        '-tt',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=4',
        '-p', String(useSpec.port),
      ];
      if (useSpec.keyPath) {
        shellArgs.push('-i', useSpec.keyPath);
        shellArgs.push('-o', 'IdentitiesOnly=yes');
      }
      if (useSpec.knownHosts) {
        shellArgs.push('-o', `UserKnownHostsFile=${useSpec.knownHosts}`);
        shellArgs.push('-o', 'StrictHostKeyChecking=yes');
      } else {
        socket.emit(
          'terminal:error',
          'No known_hosts configured for this server. Generate one with: ssh-keyscan -p ' +
            useSpec.port +
            ' ' +
            useSpec.host +
            ' > ./secrets/known_hosts',
        );
        socket.disconnect(true);
        return;
      }
      shellArgs.push(`${useSpec.user}@${useSpec.host}`);
    } else {
      // Local-container mode. If TERMINAL_USER differs from the current
      // process user, drop into that account via sudo.
      const currentUser = (() => {
        try {
          return require('os').userInfo().username;
        } catch (_) {
          return '';
        }
      })();
      const wantUser = cfg.user && cfg.user !== currentUser ? cfg.user : '';
      if (wantUser) {
        shell = '/usr/bin/sudo';
        shellArgs = ['-i', '-u', wantUser];
        spawnOptions.cwd = '/';
      } else {
        shell = cfg.shell;
      }
    }

    let term;
    let dbSessionId = null;
    const prisma = getPrisma();

    try {
      term = pty.spawn(shell, shellArgs, spawnOptions);
    } catch (err) {
      console.error('[terminal] spawn failed', err && err.message);
      socket.emit('terminal:error', 'Failed to start shell: ' + (err && err.message));
      socket.disconnect(true);
      return;
    }

    socket.emit('terminal:ready', {
      pid: term.pid,
      shell,
      cwd: cfg.startDir,
      user: useSpec
        ? `${useSpec.user}@${useSpec.host}` + (serverRecord ? ` (${serverRecord.name})` : '')
        : cfg.user || (process.getuid ? 'uid:' + process.getuid() : 'app-user'),
    });

    (async () => {
      if (!prisma) return;
      try {
        const session = await prisma.terminalSession.create({
          data: { userId, ipAddress: socket.data.ip, status: 'active' },
        });
        dbSessionId = session.id;
        await attachAudit(prisma, {
          userId,
          action: 'terminal.session_opened',
          target: session.id,
          ipAddress: socket.data.ip,
          metadata: { shell, user: cfg.user || null },
        });
      } catch (err) {
        console.error('[terminal] could not record session', err && err.message);
      }
    })();

    term.onData((data) => {
      socket.emit('terminal:data', data);
    });

    term.onExit(({ exitCode, signal }) => {
      socket.emit('terminal:exit', { exitCode, signal });
      socket.disconnect(true);
    });

    // Optional command audit: log finished lines when the user presses Enter.
    let commandBuffer = '';
    socket.on('terminal:input', async (chunk) => {
      if (typeof chunk !== 'string') return;
      try {
        term.write(chunk);
      } catch (err) {
        console.error('[terminal] write failed', err && err.message);
      }
      if (cfg.auditCommands) {
        for (const ch of chunk) {
          if (ch === '\r' || ch === '\n') {
            const cmd = commandBuffer.trim();
            commandBuffer = '';
            if (cmd) {
              attachAudit(prisma, {
                userId,
                action: 'terminal.command',
                target: dbSessionId,
                ipAddress: socket.data.ip,
                metadata: { command: cmd.slice(0, 500) },
              });
            }
          } else if (ch === '\x7f' || ch === '\b') {
            commandBuffer = commandBuffer.slice(0, -1);
          } else if (ch >= ' ' || ch === '\t') {
            commandBuffer += ch;
            if (commandBuffer.length > 2048) commandBuffer = commandBuffer.slice(-2048);
          }
        }
      }
    });

    socket.on('terminal:resize', ({ cols, rows }) => {
      if (typeof cols !== 'number' || typeof rows !== 'number') return;
      const c = Math.max(2, Math.min(500, Math.floor(cols)));
      const r = Math.max(2, Math.min(200, Math.floor(rows)));
      try {
        term.resize(c, r);
      } catch (err) {
        // Ignore — process may have already exited.
      }
    });

    socket.on('disconnect', async () => {
      try {
        term.kill();
      } catch (_) {
        /* already gone */
      }
      const set = sessionsByUser.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) sessionsByUser.delete(userId);
      }
      if (prisma && dbSessionId) {
        try {
          await prisma.terminalSession.update({
            where: { id: dbSessionId },
            data: { endedAt: new Date(), status: 'closed' },
          });
          await attachAudit(prisma, {
            userId,
            action: 'terminal.session_closed',
            target: dbSessionId,
            ipAddress: socket.data.ip,
          });
        } catch (err) {
          console.error('[terminal] close cleanup failed', err && err.message);
        }
      }
    });
  });

  server.listen(port, hostname, () => {
    console.log(`\n┌──────────────────────────────────────────────────────┐`);
    console.log(`│  CachePanel — Secure server control, the Cache way.  │`);
    console.log(`└──────────────────────────────────────────────────────┘`);
    console.log(`  Listening on http://${hostname}:${port}`);
    if (process.getuid && process.getuid() === 0) {
      console.warn('  ⚠  Running as root — strongly discouraged. Set TERMINAL_USER and run as a limited user.');
    }
    if (!pty) {
      console.warn('  ⚠  node-pty unavailable — /terminal will be disabled.');
    }
  });

  // ---- Alert pollers (Discord webhook alerts feature) ------------------
  // Calls our own /api/internal/alerts/poll endpoint every 60s with an
  // HMAC-signed header. The route runs the TS poller and returns.
  // Skip if NEXTAUTH_SECRET is unset (dev / misconfigured).
  if (process.env.NEXTAUTH_SECRET) {
    const crypto = require('node:crypto');
    const internalToken = crypto
      .createHmac('sha256', process.env.NEXTAUTH_SECRET)
      .update('alerts-poll')
      .digest('hex');
    const pollUrl = `http://127.0.0.1:${port}/api/internal/alerts/poll`;
    const pollOnce = async () => {
      try {
        await fetch(pollUrl, {
          method: 'POST',
          headers: { 'x-cachepanel-internal': internalToken },
        });
      } catch (err) {
        // Pre-listen ticks fail loudly otherwise; once the server is up the
        // calls succeed and we go silent.
        if (err && err.code !== 'ECONNREFUSED') {
          console.error('[alerts] poll trigger failed:', err.message || err);
        }
      }
    };
    // First tick after 30s (let Next.js finish warming), then every 60s.
    setTimeout(() => {
      pollOnce();
      setInterval(pollOnce, 60_000);
    }, 30_000);
  }
})();
