// Windows remote-host adapter. Talks to a Windows host that has OpenSSH
// Server enabled (Settings → Apps → Optional Features → OpenSSH Server)
// and runs PowerShell snippets to do everything the Linux adapter does via
// POSIX shell. PowerShell 7+ (`pwsh`) is preferred; the adapter falls back
// to the bundled `powershell.exe` (Windows PowerShell 5.1) when pwsh isn't
// on PATH.
//
// Wire-format strategy: every command returns JSON via `ConvertTo-Json -Depth N`
// so the panel parses one shape regardless of OS. Errors are surfaced via
// exit code; the adapter never trusts stderr formatting.

import type { Server } from '@prisma/client';
import { runOnHost, runOnHostStdin } from '../host-probe';
import type {
  AdapterCallOpts,
  HostEntry,
  HostGpu,
  HostSnapshot,
  HostStat,
  RemoteHostAdapter,
  RunResult,
} from '../host-adapter';

// Run a PowerShell snippet. We prefer pwsh (cross-platform, faster startup),
// fall back to powershell.exe (always available on Windows). `-NoProfile`
// skips user profiles for speed + determinism; `-NonInteractive` disables
// prompts; `-Command -` reads the script from stdin so we don't have to
// escape quotes through the SSH layer.
function psWrap(script: string, shellOverride: string | null | undefined): string {
  const shell = shellOverride || 'pwsh';
  // Two-shell fallback: try pwsh first; if it's not on PATH, fall back to
  // Windows PowerShell. The where.exe check is fast and avoids spawning
  // pwsh just to discover it doesn't exist.
  if (shell === 'pwsh') {
    // Prefer pwsh, fall back to powershell.exe on stock Windows.
    return `where.exe pwsh >nul 2>&1 && (pwsh -NoProfile -NonInteractive -Command -) || (powershell.exe -NoProfile -NonInteractive -Command -)`;
  }
  return `${shell} -NoProfile -NonInteractive -Command -`;
}

// PowerShell single-quote escape. Single-quoted PS strings only need the
// quote itself doubled — backslashes pass through unchanged (unlike bash).
function psQuote(s: string): string {
  return `'${s.replace(/'/g, `''`)}'`;
}

function withServer(serverId: string, opts?: AdapterCallOpts) {
  return { serverId, userId: opts?.userId ?? null, timeoutMs: opts?.timeoutMs };
}

// Wrap a PS snippet and pipe it in via stdin so quoting doesn't have to
// survive SSH's shell layer too.
async function runPs(
  serverId: string,
  shellOverride: string | null | undefined,
  script: string,
  opts: AdapterCallOpts | undefined,
  timeoutMs = 15_000,
): Promise<RunResult> {
  const wrapped = psWrap(script, shellOverride);
  return runOnHostStdin(wrapped, script, {
    ...withServer(serverId, opts),
    timeoutMs: opts?.timeoutMs ?? timeoutMs,
  });
}

// Parse PS JSON output that ConvertTo-Json *sometimes* emits as a single
// object instead of an array when there's exactly one item. Normalise.
function jsonArray<T>(raw: string): T[] {
  const t = raw.trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t) as T | T[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

interface PsListEntry {
  Name: string;
  Length?: number;
  LastWriteTime?: string;
  Mode?: string;
  Attributes?: string;
  PSIsContainer?: boolean;
}

export function makeWindowsAdapter(server: Server): RemoteHostAdapter {
  const sid = server.id;
  const shell = server.shellPath ?? null;

  return {
    os: 'windows',

    // ---------------- Filesystem ----------------

    async listDir(absPath, opts) {
      const script = `
$ErrorActionPreference='SilentlyContinue'
try {
  Get-ChildItem -Force -LiteralPath ${psQuote(absPath)} | ForEach-Object {
    [pscustomobject]@{
      Name = $_.Name
      Length = if ($_.PSIsContainer) { 0 } else { $_.Length }
      LastWriteTime = $_.LastWriteTime.ToString('o')
      PSIsContainer = [bool]$_.PSIsContainer
      IsSymlink = ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    }
  } | ConvertTo-Json -Compress -Depth 3
} catch { exit 1 }`;
      const r = await runPs(sid, shell, script, opts, opts?.timeoutMs ?? 10_000);
      if (r.code !== 0) return null;
      const items = jsonArray<PsListEntry & { IsSymlink: boolean }>(r.stdout);
      return items.map((e) => ({
        name: e.Name,
        type: e.IsSymlink ? 'symlink' : e.PSIsContainer ? 'directory' : 'file',
        size: e.Length ?? 0,
        modifiedAt: e.LastWriteTime ?? null,
      }));
    },

    async stat(absPath, opts) {
      const script = `
$ErrorActionPreference='SilentlyContinue'
$p = ${psQuote(absPath)}
$item = Get-Item -Force -LiteralPath $p
if (-not $item) { exit 1 }
[pscustomobject]@{
  Length = if ($item.PSIsContainer) { 0 } else { $item.Length }
  LastWriteTime = $item.LastWriteTime.ToString('o')
  PSIsContainer = [bool]$item.PSIsContainer
  IsSymlink = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
} | ConvertTo-Json -Compress`;
      const r = await runPs(sid, shell, script, opts);
      if (r.code !== 0 || !r.stdout.trim()) return null;
      try {
        const j = JSON.parse(r.stdout.trim()) as PsListEntry & { IsSymlink: boolean };
        return {
          type: j.IsSymlink ? 'symlink' : j.PSIsContainer ? 'directory' : 'file',
          size: j.Length ?? 0,
          modifiedAt: j.LastWriteTime ?? null,
        };
      } catch {
        return null;
      }
    },

    async readBytes(absPath, maxBytes, opts) {
      // [IO.File]::ReadAllBytes loads the file fully — guard with Length first.
      const script = `
$p = ${psQuote(absPath)}
$len = (Get-Item -LiteralPath $p).Length
if ($len -gt ${maxBytes}) { Write-Error 'too-large'; exit 2 }
[Convert]::ToBase64String([IO.File]::ReadAllBytes($p))`;
      const r = await runPs(sid, shell, script, opts, 60_000);
      if (r.code !== 0) return null;
      try {
        return Buffer.from(r.stdout.trim(), 'base64');
      } catch {
        return null;
      }
    },

    async readText(absPath, maxBytes, opts) {
      const buf = await this.readBytes(absPath, maxBytes, opts);
      return buf ? buf.toString('utf-8') : null;
    },

    async writeBytes(absPath, buf, opts) {
      // Stream the base64 payload through SSH stdin so we don't blow out
      // the PS command line (Windows has a hard ~32 KiB CreateProcess arg
      // cap that base64-in-line would hit instantly for large files).
      const script = `
$p = ${psQuote(absPath)}
$dir = Split-Path -Parent $p
if ($dir -and -not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
$b64 = [Console]::In.ReadToEnd().Trim()
[IO.File]::WriteAllBytes($p, [Convert]::FromBase64String($b64))`;
      // Two-stage stdin: PS reads stdin, but the OUTER wrapper also reads
      // stdin (the script itself). We concat: script first, then a sentinel
      // line, then the b64. Actually simpler: use the runScript escape hatch
      // and pass the script as -Command, leaving stdin clean for the payload.
      const wrappedShell = shell || 'pwsh';
      // shellPath override or pwsh-then-powershell fallback, but encode the
      // script via -EncodedCommand so we don't have to escape quotes.
      const encoded = Buffer.from(script, 'utf-16le').toString('base64');
      const cmd =
        wrappedShell === 'pwsh'
          ? `where.exe pwsh >nul 2>&1 && (pwsh -NoProfile -NonInteractive -EncodedCommand ${encoded}) || (powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded})`
          : `${wrappedShell} -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
      const r = await runOnHostStdin(cmd, buf.toString('base64'), {
        ...withServer(sid, opts),
        timeoutMs: opts?.timeoutMs ?? 60_000,
      });
      return r.code === 0;
    },

    async writeText(absPath, content, opts) {
      return this.writeBytes(absPath, Buffer.from(content, 'utf-8'), opts);
    },

    async mkdir(absPath, recursive, opts) {
      // New-Item -Force creates parents.
      const script = recursive
        ? `New-Item -ItemType Directory -Force -Path ${psQuote(absPath)} | Out-Null`
        : `New-Item -ItemType Directory -Path ${psQuote(absPath)} | Out-Null`;
      const r = await runPs(sid, shell, script, opts);
      return r.code === 0;
    },

    async createFile(absPath, opts) {
      const script = `
$p = ${psQuote(absPath)}
$dir = Split-Path -Parent $p
if ($dir -and -not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
New-Item -ItemType File -Force -Path $p | Out-Null`;
      const r = await runPs(sid, shell, script, opts);
      return r.code === 0;
    },

    async remove(absPath, recursive, opts) {
      const script = recursive
        ? `Remove-Item -LiteralPath ${psQuote(absPath)} -Recurse -Force -ErrorAction SilentlyContinue`
        : `Remove-Item -LiteralPath ${psQuote(absPath)} -Force -ErrorAction SilentlyContinue`;
      const r = await runPs(sid, shell, script, opts, 20_000);
      return r.code === 0;
    },

    async move(from, to, opts) {
      const script = `Move-Item -LiteralPath ${psQuote(from)} -Destination ${psQuote(to)} -Force`;
      const r = await runPs(sid, shell, script, opts);
      return r.code === 0;
    },

    // ---------------- Scheduled jobs (Task Scheduler) ----------------

    // Windows doesn't have a crontab file. We model jobs as
    // "CachePanel\<tag>" entries under \\Microsoft\\Windows\\CachePanel
    // path in Task Scheduler. listScheduledJobs returns a stub line per
    // task; the OS-native upsert/delete methods are the real implementation
    // that scheduled-jobs.ts will prefer when available.

    async listScheduledJobs(opts) {
      const script = `
$ErrorActionPreference='SilentlyContinue'
Get-ScheduledTask -TaskPath '\\CachePanel\\' | ForEach-Object {
  $action = $_.Actions[0].Execute + ' ' + $_.Actions[0].Arguments
  Write-Output ("# cachepanel:" + $_.TaskName + "\`n" + $action)
}`;
      const r = await runPs(sid, shell, script, opts);
      return r.stdout;
    },

    async writeScheduledJobs() {
      // Bulk crontab writes don't translate cleanly to Task Scheduler.
      // scheduled-jobs.ts knows to call upsertScheduledJob / deleteScheduledJob
      // when the adapter is Windows instead.
      return false;
    },

    async upsertScheduledJob({ tag, cron, command, opts }) {
      // Convert standard 5-field cron → Task Scheduler trigger args. We
      // support the common cases: "@hourly" → -Once + RepetitionInterval,
      // "*/N * * * *" → minutes, "0 N * * *" → daily at HH:00. Anything
      // exotic falls back to a 1-minute polling trigger that the task's
      // own command can skip when it shouldn't run — same shape as cron
      // anyway.
      const parts = cron.trim().split(/\s+/);
      let trigger = `New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)`;
      if (parts.length === 5) {
        const [m, h, dom, mon, dow] = parts;
        if (m && m.startsWith('*/') && h === '*') {
          const every = parseInt(m.slice(2), 10);
          if (every > 0) {
            trigger = `New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes ${every})`;
          }
        } else if (h && /^\d+$/.test(h) && m && /^\d+$/.test(m) && dom === '*' && mon === '*' && dow === '*') {
          trigger = `New-ScheduledTaskTrigger -Daily -At '${h.padStart(2, '0')}:${m.padStart(2, '0')}'`;
        }
      }
      const script = `
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c ${command.replace(/'/g, "''")}'
$trigger = ${trigger}
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
Register-ScheduledTask -TaskPath '\\CachePanel\\' -TaskName ${psQuote(tag)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`;
      const r = await runPs(sid, shell, script, opts);
      return r.code === 0;
    },

    async deleteScheduledJob(tag, opts) {
      const script = `
$ErrorActionPreference='SilentlyContinue'
Unregister-ScheduledTask -TaskPath '\\CachePanel\\' -TaskName ${psQuote(tag)} -Confirm:$false`;
      const r = await runPs(sid, shell, script, opts);
      return r.code === 0;
    },

    // ---------------- User provisioning ----------------

    async userExists(username, opts) {
      const script = `
$ErrorActionPreference='SilentlyContinue'
if (Get-LocalUser -Name ${psQuote(username)}) { exit 0 } else { exit 1 }`;
      const r = await runPs(sid, shell, script, opts);
      return r.code === 0;
    },

    async addUser(username, opts) {
      // Use New-LocalUser, no password (require interactive prompt via
      // -NoPassword), and add to docker-users so docker access works.
      const script = `
$ErrorActionPreference='Stop'
$u = ${psQuote(username)}
if (-not (Get-LocalUser -Name $u -ErrorAction SilentlyContinue)) {
  New-LocalUser -Name $u -NoPassword -AccountNeverExpires | Out-Null
  Add-LocalGroupMember -Group 'Users' -Member $u -ErrorAction SilentlyContinue | Out-Null
  Add-LocalGroupMember -Group 'docker-users' -Member $u -ErrorAction SilentlyContinue | Out-Null
}`;
      return runPs(sid, shell, script, opts);
    },

    async appendAuthorizedKey(username, publicKey, opts) {
      // OpenSSH Server on Windows reads ~/.ssh/authorized_keys for ordinary
      // users; administrators use C:\ProgramData\ssh\administrators_authorized_keys.
      // We support the common case (non-admin user) here.
      const safeKey = publicKey.replace(/'/g, `''`);
      const script = `
$u = ${psQuote(username)}
$home = (Get-LocalUser -Name $u).PrincipalSource | Out-Null
$profile = (Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -like "*\\$u" }).LocalPath
if (-not $profile) { $profile = "C:\\Users\\$u" }
$sshDir = Join-Path $profile '.ssh'
$ak = Join-Path $sshDir 'authorized_keys'
if (-not (Test-Path -LiteralPath $sshDir)) {
  New-Item -ItemType Directory -Force -Path $sshDir | Out-Null
}
Add-Content -Path $ak -Value '${safeKey}'
# Tight ACL: SYSTEM + the user only (matches OpenSSH Server's expectations).
icacls $ak /inheritance:r /grant:r "$u:F" "SYSTEM:F" | Out-Null`;
      return runPs(sid, shell, script, opts);
    },

    // ---------------- System probe ----------------

    async snapshot(opts) {
      const script = `
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$uptimeSec = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds
[pscustomobject]@{
  Hostname     = $cs.Name
  OsRelease    = $os.Caption + ' ' + $os.Version
  CpuCount     = $cpu.NumberOfLogicalProcessors
  CpuLoadPct   = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  UptimeSec    = $uptimeSec
  MemTotalMb   = [int]($os.TotalVisibleMemorySize / 1024)
  MemFreeMb    = [int]($os.FreePhysicalMemory / 1024)
  MemUsedMb    = [int](($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1024)
  DiskTotalGb  = [int]($disk.Size / 1GB)
  DiskFreeGb   = [int]($disk.FreeSpace / 1GB)
  DiskUsedGb   = [int](($disk.Size - $disk.FreeSpace) / 1GB)
} | ConvertTo-Json -Compress`;
      const r = await runPs(sid, shell, script, opts, 10_000);
      if (r.code !== 0 || !r.stdout.trim()) return null;
      try {
        const j = JSON.parse(r.stdout.trim()) as {
          Hostname: string; OsRelease: string;
          CpuCount: number; CpuLoadPct: number; UptimeSec: number;
          MemTotalMb: number; MemFreeMb: number; MemUsedMb: number;
          DiskTotalGb: number; DiskFreeGb: number; DiskUsedGb: number;
        };
        return {
          hostname: j.Hostname,
          osRelease: j.OsRelease,
          cpuCount: j.CpuCount,
          // Windows' Win32_Processor LoadPercentage is 0-100, the panel
          // shows load average like Linux. Best-effort divide by 100 so the
          // UI's "load > N cores = red" logic still makes sense.
          cpuLoad1m: typeof j.CpuLoadPct === 'number' ? j.CpuLoadPct / 100 : null,
          uptimeSec: j.UptimeSec,
          memTotalMb: j.MemTotalMb,
          memFreeMb: j.MemFreeMb,
          memUsedMb: j.MemUsedMb,
          diskTotalGb: j.DiskTotalGb,
          diskFreeGb: j.DiskFreeGb,
          diskUsedGb: j.DiskUsedGb,
        } satisfies HostSnapshot;
      } catch {
        return null;
      }
    },

    async gpu(opts) {
      const script = `
$ErrorActionPreference='SilentlyContinue'
Get-CimInstance Win32_VideoController | ForEach-Object {
  [pscustomobject]@{
    Vendor    = $_.AdapterCompatibility
    Model     = $_.Name
    Driver    = $_.DriverVersion
    VramMb    = [int]($_.AdapterRAM / 1MB)
  }
} | ConvertTo-Json -Compress -Depth 3`;
      const r = await runPs(sid, shell, script, opts);
      if (r.code !== 0) return [];
      const items = jsonArray<{ Vendor: string | null; Model: string | null; Driver: string | null; VramMb: number | null }>(
        r.stdout,
      );
      return items.map<HostGpu>((g) => ({
        vendor: g.Vendor,
        model: g.Model,
        driver: g.Driver,
        vramMb: g.VramMb,
        // CIM doesn't expose live VRAM usage / load / temp on most adapters.
        // Add NVIDIA nvidia-smi.exe fallback later if anyone asks.
        vramUsedMb: null,
        vramFreeMb: null,
        loadPct: null,
        memLoadPct: null,
        tempC: null,
        powerW: null,
      }));
    },

    // ---------------- Docker on this host ----------------

    getDockerSocket() {
      // Docker Desktop on Windows exposes the daemon on the named pipe.
      return process.env.DOCKER_SOCKET || '//./pipe/docker_engine';
    },

    async dockerVersion(opts) {
      // `docker.exe version --format` works identically on Windows.
      const r = await runPs(
        sid,
        shell,
        `docker version --format '{{json .Server}}' 2>$null`,
        opts,
      );
      if (r.code !== 0 || !r.stdout.trim()) return null;
      try {
        const j = JSON.parse(r.stdout.trim()) as { Version?: string; ApiVersion?: string };
        return { version: j.Version ?? '?', api: j.ApiVersion ?? '?' };
      } catch {
        return null;
      }
    },

    // ---------------- Escape hatch ----------------

    async runScript(script, opts): Promise<RunResult> {
      return runPs(sid, shell, script, opts);
    },

    async runScriptWithStdin(script, stdin, opts): Promise<RunResult> {
      // Same trick as writeBytes: encode the script, leave stdin clean for
      // the caller's payload.
      const wrappedShell = shell || 'pwsh';
      const encoded = Buffer.from(script, 'utf-16le').toString('base64');
      const cmd =
        wrappedShell === 'pwsh'
          ? `where.exe pwsh >nul 2>&1 && (pwsh -NoProfile -NonInteractive -EncodedCommand ${encoded}) || (powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded})`
          : `${wrappedShell} -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
      return runOnHostStdin(cmd, stdin, withServer(sid, opts));
    },
  };
}
