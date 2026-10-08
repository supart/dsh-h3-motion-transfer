// Fetch ffmpeg and ffprobe into assets/tools/vendor/bin/<platform>-<arch>/ so the
// sheet tools work on a machine that never installed ffmpeg by hand.
//
// Usage:
//   node prefetch-ffmpeg.mjs [--mirror <base-url>] [--url <archive-url>] [--force]
//                            [--no-proxy] [--strict] [--dry-run]
//
// Order of attempts: --url -> mirror -> gyan.dev (Windows) -> BtbN nightly (all
// platforms) -> npm packages via pnpm. Every failure prints a recovery hint and
// the script still exits 0 unless --strict is passed, so it can never hard-fail an
// install.
//
// Proxies: an explicit proxy (https_proxy / HTTPS_PROXY / http_proxy /
// HTTP_PROXY / ALL_PROXY) is used through a CONNECT tunnel built on node:http and
// node:https, so downloads work with no added dependency. The tunnel is verified
// against a small probe before use; if the proxy refuses it, the script says so,
// retries directly, and the npm fallback still runs.
import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { readdir, copyFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, Agent as HttpsAgent } from 'node:https';
import { CONFIG_PATH, VENDOR_DIR, flagOn, parseArgs, resolveBin, resolveFont } from './lib/resolve-bin.mjs';

const run = promisify(execFile);
const EXE = process.platform === 'win32' ? '.exe' : '';
const TARGETS = ['ffmpeg', 'ffprobe'];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const NPM_PACKAGE = { ffmpeg: 'ffmpeg-static', ffprobe: 'ffprobe-static' };

const args = parseArgs(process.argv.slice(2));
const mirror = typeof args.mirror === 'string' ? args.mirror.replace(/\/+$/u, '') : undefined;
const directUrl = typeof args.url === 'string' ? args.url : undefined;
const force = flagOn(args.force);
const strict = flagOn(args.strict);
const dryRun = flagOn(args['dry-run']);
const useProxy = !flagOn(args['no-proxy']);

const proxyUrl = (useProxy
  ? process.env.https_proxy ?? process.env.HTTPS_PROXY
    ?? process.env.http_proxy ?? process.env.HTTP_PROXY
    ?? process.env.all_proxy ?? process.env.ALL_PROXY
  : undefined) ?? '';

/** Sockets kept so an interrupted run can be torn down cleanly. */
const activeSockets = new Set();
const killSockets = () => {
  for (const socket of activeSockets) socket.destroy();
  activeSockets.clear();
};
process.on('SIGINT', () => {
  killSockets();
  process.exit(130);
});

/** Candidate archives, in the order we try them for this platform. */
function sources() {
  const list = [];
  if (directUrl !== undefined) list.push({ name: 'explicit --url', url: directUrl });
  if (mirror !== undefined) list.push({ name: `mirror ${mirror}`, url: `${mirror}/${process.platform}-${process.arch}.zip` });
  if (process.platform === 'win32') {
    list.push({ name: 'gyan.dev essentials', url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' });
    list.push({ name: 'BtbN latest win64', url: 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' });
  } else if (process.platform === 'darwin') {
    list.push({ name: 'evermeet.cx ffmpeg', url: 'https://evermeet.cx/ffmpeg/getrelease/zip' });
    list.push({ name: 'evermeet.cx ffprobe', url: 'https://evermeet.cx/ffprobe/getrelease/zip' });
  } else {
    list.push({ name: 'BtbN latest linux64', url: 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz' });
  }
  return list;
}

/**
 * Walk a CONNECT tunnel: dial the proxy, ask it for `host:port`, then run the
 * target request over the returned socket.
 */
function requestThroughProxy(proxy, url, callback) {
  const target = new URL(url);
  const targetPort = target.port === '' ? 443 : Number(target.port);
  const connect = proxy.protocol === 'https:' ? httpsRequest : httpRequest;
  const connectOptions = {
    method: 'CONNECT',
    hostname: proxy.hostname,
    port: Number(proxy.port === '' ? (proxy.protocol === 'https:' ? 443 : 80) : proxy.port),
    path: `${target.hostname}:${targetPort}`,
    headers: { host: `${target.hostname}:${targetPort}` },
  };
  if (proxy.username !== '') {
    connectOptions.headers['proxy-authorization'] = `Basic ${Buffer.from(
      `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
    ).toString('base64')}`;
  }
  const connectReq = connect(connectOptions);
  connectReq.setTimeout(60_000, () => connectReq.destroy(new Error('proxy CONNECT timed out after 60000ms')));
  connectReq.on('connect', (response, socket) => {
    if (response.statusCode !== 200) {
      socket.destroy();
      callback(new Error(`proxy CONNECT failed with status ${response.statusCode}`));
      return;
    }
    socket.setTimeout(0);
    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));
    const agent = new HttpsAgent({ keepAlive: false, maxSockets: 4 });
    agent.createConnection = (options, oncreate) => {
      if (oncreate !== undefined) oncreate(null, socket);
      return socket;
    };
    const inner = httpsRequest({
      method: 'GET',
      hostname: target.hostname,
      port: targetPort,
      path: `${target.pathname}${target.search}`,
      headers: { 'user-agent': 'dsh-h3-motion-transfer-prefetch', accept: '*/*' },
      agent,
    }, (res) => {
      res.on('close', () => agent.destroy());
      callback(null, res);
    });
    inner.on('error', (error) => {
      agent.destroy();
      callback(error);
    });
    inner.setTimeout(60_000, () => inner.destroy(new Error('request timed out after 60000ms')));
    inner.end();
  });
  connectReq.on('error', callback);
  connectReq.end();
}

/** One GET, either directly or through the proxy tunnel. */
function getOnce(proxy, url) {
  if (proxy === undefined) {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const req = httpsRequest({
        method: 'GET',
        hostname: target.hostname,
        port: target.port === '' ? 443 : Number(target.port),
        path: `${target.pathname}${target.search}`,
        headers: { 'user-agent': 'dsh-h3-motion-transfer-prefetch', accept: '*/*' },
      }, (res) => resolve(res));
      req.setTimeout(60_000, () => req.destroy(new Error('request timed out after 60000ms')));
      req.on('error', reject);
      req.end();
    });
  }
  return new Promise((resolve, reject) => {
    requestThroughProxy(proxy, url, (error, res) => (error ? reject(error) : resolve(res)));
  });
}

/** Stream a URL to disk, following up to five redirects and reporting progress. */
async function download(proxy, url, dest, hops = 0) {
  if (hops > 5) throw new Error('too many redirects');
  const response = await getOnce(proxy, url);
  const status = response.statusCode ?? 0;
  const location = response.headers.location;
  if (REDIRECTS.has(status) && typeof location === 'string') {
    response.resume();
    console.log(`prefetch:   ${status} -> ${new URL(location, url).host}`);
    return download(proxy, new URL(location, url).toString(), dest, hops + 1);
  }
  if (status !== 200) {
    response.resume();
    throw new Error(`HTTP ${status}`);
  }
  let bytes = 0;
  let nextReport = Date.now() + 5_000;
  response.on('data', (chunk) => {
    bytes += chunk.length;
    if (Date.now() >= nextReport) {
      nextReport = Date.now() + 5_000;
      process.stdout.write(`prefetch:   ${(bytes / 1024 / 1024).toFixed(1)} MB\r`);
    }
  });
  await new Promise((resolve, reject) => {
    const out = createWriteStream(dest);
    response.pipe(out);
    response.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
  });
  process.stdout.write(`prefetch:   ${(bytes / 1024 / 1024).toFixed(1)} MB downloaded\n`);
  return bytes;
}

/** Verify the proxy tunnel once, so a refusal is reported instead of retried per source. */
async function probeTunnel(proxy) {
  try {
    const response = await getOnce(proxy, 'https://registry.npmmirror.com/');
    response.resume();
    return true;
  } catch (error) {
    console.warn(`prefetch: proxy tunnel unavailable (${error.message}); trying direct connections`);
    return false;
  }
}

/**
 * Extract with the platform's own tooling: `tar` reads zip and tar archives on
 * Windows 10+/macOS/Linux, so there is no archive library to carry.
 */
async function extract(archive, outDir) {
  mkdirSync(outDir, { recursive: true });
  await run('tar', ['-xf', archive, '-C', outDir], { maxBuffer: 64 * 1024 * 1024 });
  return outDir;
}

/** Find a file named `<name>[.exe]` anywhere below `dir`. */
async function findBinary(dir, name) {
  const wanted = `${name}${EXE}`;
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

/** ffprobe-static ships its binaries inside the tarball; read it if it is around. */
function fromNpm(name) {
  const require = createRequire(import.meta.url);
  try {
    const mod = require(NPM_PACKAGE[name]);
    const candidate = typeof mod === 'string' ? mod : mod?.path ?? mod?.default;
    if (typeof candidate === 'string' && existsSync(candidate)) return candidate;
  } catch {
    // not installed here
  }
  return undefined;
}

/**
 * Last resort: let pnpm download the package. pnpm speaks the registry mirror and
 * the proxy correctly, so this covers networks where the archive hosts are
 * unreachable. Only ffprobe-static is reliable this way: ffmpeg-static downloads
 * its binary in a build script that pnpm blocks by default and that ignores
 * HTTPS_PROXY, so a proxy-only network still needs the manual route.
 */
async function viaPnpm(target, staging) {
  const dir = join(staging, `npm-${target}`);
  mkdirSync(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({ name: `prefetch-${target}`, private: true }, null, 2)}\n`, 'utf8');
  const addArgs = ['add', '--dir', dir, NPM_PACKAGE[target]];
  // Node cannot exec a Windows .cmd shim without a shell (spawn EINVAL).
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm', ...addArgs] : addArgs;
  const added = await run(command, commandArgs, { maxBuffer: 32 * 1024 * 1024 })
    .then(() => true)
    .catch((error) => {
      console.log(`prefetch:   pnpm add failed: ${String(error.message).split(/\r?\n/u)[0]}`);
      return false;
    });
  if (!added) return undefined;
  const require = createRequire(join(dir, 'package.json'));
  try {
    const mod = require(NPM_PACKAGE[target]);
    const candidate = typeof mod === 'string' ? mod : mod?.path ?? mod?.default;
    return typeof candidate === 'string' && existsSync(candidate) ? candidate : undefined;
  } catch (error) {
    console.log(`prefetch:   resolve failed: ${String(error.message).split(/\r?\n/u)[0]}`);
    return undefined;
  }
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
  console.log(`prefetch: proxy ${proxyUrl === '' ? '(none)' : `${proxyUrl} (CONNECT tunnel)`}`);
  for (const source of plan) console.log(`  would try ${source.name}: ${source.url}`);
  console.log('  then: pnpm add ffmpeg-static / ffprobe-static (ffprobe-static carries its binaries in the tarball)');
  console.log('  tip: pass --url <archive> for your own mirror or a direct release asset');
  process.exit(0);
}

let proxy;
if (proxyUrl !== '') {
  proxy = new URL(proxyUrl);
  console.log(`prefetch: proxy ${proxyUrl}`);
  if (!await probeTunnel(proxy)) proxy = undefined;
  else console.log('prefetch: tunnel verified');
}

mkdirSync(VENDOR_DIR, { recursive: true });
const staging = join(VENDOR_DIR, '.staging');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

const missing = new Set(TARGETS);
for (const source of plan) {
  if (missing.size === 0) break;
  const name = basename(new URL(source.url).pathname) || 'archive';
  const archive = join(staging, name);
  try {
    console.log(`prefetch: trying ${source.name}`);
    await download(proxy, source.url, archive);
    console.log(`prefetch:   archive ${(statSync(archive).size / 1024 / 1024).toFixed(1)} MB, extracting with tar`);
    const extracted = await extract(archive, join(staging, 'x'));
    for (const target of [...missing]) {
      const found = await findBinary(extracted, target);
      if (found === undefined) continue;
      await copyFile(found, join(VENDOR_DIR, `${target}${EXE}`));
      try {
        await run('chmod', ['+x', join(VENDOR_DIR, `${target}${EXE}`)]);
      } catch {
        // Windows has no chmod
      }
      missing.delete(target);
      report(true, target, `installed from ${source.name}`);
    }
    rmSync(join(staging, 'x'), { recursive: true, force: true });
  } catch (error) {
    report(false, source.name, error.message);
  }
}

for (const target of [...missing]) {
  const found = fromNpm(target) ?? await viaPnpm(target, staging);
  if (found === undefined) continue;
  await copyFile(found, join(VENDOR_DIR, `${target}${EXE}`));
  missing.delete(target);
  report(true, target, 'installed from the npm package');
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
console.error('  - offline: download a build elsewhere and pass it as --url <archive path or URL>');
console.error('  - proxied network: try --url <mirror archive> or --no-proxy');
process.exit(strict ? 1 : 0);
