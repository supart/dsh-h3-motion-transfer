// Fetch ffmpeg and ffprobe into assets/tools/vendor/bin/<platform>-<arch>/ so the
// sheet tools work on a machine that never installed ffmpeg by hand.
//
// Usage:
//   node prefetch-ffmpeg.mjs [--mirror <base-url>] [--force] [--strict] [--dry-run]
//
// Order of attempts: GitHub Releases --mirror (when given) -> gyan.dev (Windows)
// -> BtbN nightly (all platforms) -> an npm package that carries the binary.
// Every failure prints a recovery hint and the script still exits 0 unless
// --strict is passed, so it can never hard-fail an install.
//
// HTTPS_PROXY / HTTP_PROXY are honoured: this project is used where github.com
// is often unreachable without the local proxy.
import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { CONFIG_PATH, VENDOR_DIR, flagOn, parseArgs, resolveBin, resolveFont } from './lib/resolve-bin.mjs';

const run = promisify(execFile);
const EXE = process.platform === 'win32' ? '.exe' : '';
const TARGETS = ['ffmpeg', 'ffprobe'];

const args = parseArgs(process.argv.slice(2));
const mirror = typeof args.mirror === 'string' ? args.mirror.replace(/\/+$/u, '') : undefined;
const force = flagOn(args.force);
const strict = flagOn(args.strict);
const dryRun = flagOn(args['dry-run']);

/** Candidate archives, in the order we try them for this platform. */
function sources() {
  const list = [];
  if (mirror !== undefined) {
    const platformDir = `${process.platform}-${process.arch}`;
    list.push({ name: `mirror ${mirror}`, url: `${mirror}/${platformDir}.zip`, kind: 'zip' });
  }
  if (process.platform === 'win32') {
    list.push({ name: 'gyan.dev essentials (zip)', url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', kind: 'zip' });
    list.push({ name: 'BtbN latest win64 (zip)', url: 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip', kind: 'zip' });
  } else if (process.platform === 'darwin') {
    list.push({ name: 'evermeet.cx ffmpeg (zip)', url: 'https://evermeet.cx/ffmpeg/getrelease/zip', kind: 'zip' });
    list.push({ name: 'evermeet.cx ffprobe (zip)', url: 'https://evermeet.cx/ffprobe/getrelease/zip', kind: 'zip' });
  } else {
    list.push({ name: 'BtbN latest linux64 (tar.xz)', url: 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz', kind: 'tar.xz' });
  }
  return list;
}

/** Proxy-aware fetch: Node's fetch ignores HTTPS_PROXY, so route through undici. */
async function fetchWithProxy(url) {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (proxy === undefined || proxy.length === 0) return fetch(url);
  try {
    const { ProxyAgent } = await import('undici');
    return fetch(url, { dispatcher: new ProxyAgent(proxy) });
  } catch {
    console.warn(`prefetch: undici unavailable, ignoring proxy ${proxy}`);
    return fetch(url);
  }
}

async function download(url, dest) {
  const response = await fetchWithProxy(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  if (response.body === null) throw new Error('empty response body');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
  return statSync(dest).size;
}

/**
 * Extract with the platform's own tooling: `tar` reads zip and tar archives on
 * Windows 10+/macOS/Linux, so there is no archive library to carry.
 * Returns the directory that holds the extracted tree.
 */
async function extract(archive, outDir) {
  mkdirSync(outDir, { recursive: true });
  await run('tar', ['-xf', archive, '-C', outDir], { maxBuffer: 32 * 1024 * 1024 });
  return outDir;
}

/** Find a file named `<name>[.exe]` anywhere below `dir`. */
async function findBinary(dir, name) {
  const wanted = `${name}${EXE}`;
  const { readdir } = await import('node:fs/promises');
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        const hit = await walk(full);
        if (hit !== undefined) return hit;
      } else if (entry.name === wanted) {
        return full;
      }
    }
    return undefined;
  };
  return walk(dir);
}

/** Last resort: ask npm for a package that already carries the binary. */
async function fromNpm(name) {
  const packages = name === 'ffmpeg' ? ['ffmpeg-static'] : ['ffprobe-static'];
  const require = createRequire(import.meta.url);
  for (const pkg of packages) {
    try {
      const mod = require(pkg);
      const candidate = typeof mod === 'string' ? mod : mod?.path ?? mod?.default;
      if (typeof candidate === 'string' && existsSync(candidate)) return candidate;
    } catch {
      // not installed here
    }
  }
  return undefined;
}

function report(ok, name, detail) {
  console.log(`${ok ? 'ok  ' : 'skip'} ${name}: ${detail}`);
}

const alreadyInstalled = TARGETS.filter((name) => existsSync(join(VENDOR_DIR, `${name}${EXE}`)));
if (!force && alreadyInstalled.length === TARGETS.length) {
  console.log(`prefetch: already present in ${VENDOR_DIR} (use --force to replace)`);
  process.exit(0);
}

const plan = sources();
if (dryRun) {
  console.log(`prefetch: vendor dir ${VENDOR_DIR}`);
  for (const source of plan) console.log(`  would try ${source.name}: ${source.url}`);
  console.log(`  fallback: npm packages ffmpeg-static / ffprobe-static`);
  process.exit(0);
}

mkdirSync(VENDOR_DIR, { recursive: true });
const staging = join(VENDOR_DIR, '.staging');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

const missing = new Set(TARGETS);
for (const source of plan) {
  if (missing.size === 0) break;
  const archive = join(staging, basename(new URL(source.url).pathname) || 'archive');
  try {
    console.log(`prefetch: trying ${source.name}`);
    const bytes = await download(source.url, archive);
    console.log(`prefetch: downloaded ${(bytes / 1024 / 1024).toFixed(1)} MB`);
    const extracted = await extract(archive, join(staging, 'x'));
    for (const name of [...missing]) {
      const found = await findBinary(extracted, name);
      if (found === undefined) continue;
      const { copyFile } = await import('node:fs/promises');
      await copyFile(found, join(VENDOR_DIR, `${name}${EXE}`));
      try {
        await run('chmod', ['+x', join(VENDOR_DIR, `${name}${EXE}`)]);
      } catch {
        // Windows has no chmod
      }
      missing.delete(name);
      report(true, name, `installed from ${source.name}`);
    }
    rmSync(join(staging, 'x'), { recursive: true, force: true });
  } catch (error) {
    report(false, source.name, error.message);
  }
}

for (const name of [...missing]) {
  const found = await fromNpm(name);
  if (found === undefined) continue;
  const { copyFile } = await import('node:fs/promises');
  await copyFile(found, join(VENDOR_DIR, `${name}${EXE}`));
  missing.delete(name);
  report(true, name, 'installed from the npm package');
}

rmSync(staging, { recursive: true, force: true });

if (missing.size === 0) {
  await writeFile(CONFIG_PATH, `${JSON.stringify({
    ffmpeg: join(VENDOR_DIR, `ffmpeg${EXE}`),
    ffprobe: join(VENDOR_DIR, `ffprobe${EXE}`),
    updated_at: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  const font = resolveFont();
  console.log(`prefetch: done. ffmpeg and ffprobe are in ${VENDOR_DIR}`);
  console.log(`prefetch: wrote ${CONFIG_PATH} so the tools find them without PATH changes`);
  console.log(`prefetch: drawtext font -> ${font.source}`);
  const { path, source } = resolveBin('ffmpeg', {});
  console.log(`prefetch: resolver now reports [${source}] ${path}`);
  process.exit(0);
}

console.error(`prefetch: could not fetch: ${[...missing].join(', ')}`);
console.error('prefetch: fall back to one of these:');
console.error('  - install ffmpeg by hand (Windows: winget install Gyan.FFmpeg | macOS: brew install ffmpeg | Debian/Ubuntu: apt install ffmpeg)');
console.error('  - set DSH_FFMPEG / DSH_FFPROBE to your existing binaries');
console.error(`  - copy the binaries into ${VENDOR_DIR}`);
console.error('  - behind a proxy, export HTTPS_PROXY=http://127.0.0.1:7897 (or pass --mirror <base-url>)');
process.exit(strict ? 1 : 0);
