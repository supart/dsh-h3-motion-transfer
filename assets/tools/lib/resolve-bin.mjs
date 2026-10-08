// Locate the ffmpeg and ffprobe executables for this machine, in a fixed order,
// so the tools work on a machine that never installed ffmpeg by hand.
//
// Resolution order (first hit wins):
//   1. --ffmpeg / --ffprobe command-line arguments
//   2. DSH_FFMPEG / DSH_FFPROBE (or FFMPEG_PATH / FFPROBE_PATH) environment variables
//   3. ffmpeg-path.json in assets/tools/ (written by the user or by prefetch)
//   4. vendor/bin/<platform>-<arch>/[ffmpeg|ffprobe][.exe], filled by prefetch-ffmpeg.mjs
//   5. npm packages that carry a binary: @ffmpeg-installer/ffmpeg, ffmpeg-static,
//      @ffprobe-installer/ffprobe, ffprobe-static
//   6. PATH entries, then well-known install locations
//
// When nothing is found the error names every location tried and gives the exact
// setup steps, so a first-time user of the plugin knows what to do.
//
// This module also owns the two pieces the sheet tools share: the `drawtext`
// font choice (Windows Arial, macOS Arial, Linux DejaVu; ffmpeg's own default
// font when none of them is present) and the `--doctor` health report.
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Anchors for the whole tool set:
//   libDir     this file's directory (assets/tools/lib)
//   toolsDir   assets/tools — config file, vendor tree and the tool scripts live here
//   assetRoot  assets/
//   pluginRoot the package root that holds package.json and cordis.patch.yml
export const libDir = dirname(fileURLToPath(import.meta.url));
export const toolsDir = resolve(libDir, '..');
export const assetRoot = resolve(toolsDir, '..');
export const pluginRoot = resolve(assetRoot, '..');
// The config and the fetched binaries stay under assets/tools/, which is the
// layout the README, the SKILL notes and the resolver's error text all quote.
export const CONFIG_PATH = join(toolsDir, 'ffmpeg-path.json');
export const VENDOR_DIR = join(toolsDir, 'vendor', 'bin', `${process.platform}-${process.arch}`);
export const PREFETCH_HINT = `node ${join(toolsDir, 'prefetch-ffmpeg.mjs')}`;

const PLATFORM = process.platform;
const ARCH = process.arch;
const EXE = PLATFORM === 'win32' ? '.exe' : '';

export const isExecutable = (p) => {
  if (typeof p !== 'string' || p.length === 0 || !existsSync(p)) return false;
  if (PLATFORM === 'win32') return true;
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Parse `--key value` and bare `--flag` pairs.
 * The original loop stepped by two and therefore dropped any flag that had no
 * value (`--doctor`, `--force`), which made those options unreachable.
 * A key whose next token is missing or is another `--key` is recorded as true;
 * `--shot` may repeat and collects into an array.
 */
export function parseArgs(argv) {
  const out = { shot: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.replace(/^--/u, '');
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith('--');
    if (key === 'shot') {
      if (hasValue) out.shot.push(next);
      continue;
    }
    out[key] = hasValue ? next : true;
    if (hasValue) i += 1;
  }
  return out;
}

/** True when a flag was passed, with or without a value (`--force`, `--force true`). */
export function flagOn(value) {
  return value !== undefined && value !== 'false';
}

const readConfig = () => {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`resolve-bin: ${CONFIG_PATH} is not valid JSON (${error.message})`);
  }
};

/** Directories a Node resolution for an npm-carried binary may start from. */
function npmSearchRoots() {
  return [...new Set([pluginRoot, assetRoot, toolsDir, libDir, process.cwd()])];
}

/**
 * Pull an executable path out of whatever shape a package exposes.
 * `ffmpeg-static` exports a path string, the `@*-installer/*` packages export an
 * object with `path` (or `binary`), and some builds ship a nested `default`.
 */
function candidateFromModule(mod) {
  if (mod === null || mod === undefined) return undefined;
  if (typeof mod === 'string') return isExecutable(mod) ? mod : undefined;
  for (const key of ['path', 'binary', 'ffmpegPath', 'ffprobePath']) {
    if (typeof mod[key] === 'string' && isExecutable(mod[key])) return mod[key];
  }
  return candidateFromModule(mod.default);
}

/**
 * Try the npm packages that bundle a static binary, in preference order, for
 * every root a nested install could live under.
 * @returns {{path: string, pkg: string} | undefined}
 */
function npmCandidate(packages) {
  for (const root of npmSearchRoots()) {
    const req = createRequire(join(root, 'package.json'));
    for (const pkg of packages) {
      try {
        const resolved = req.resolve(pkg);
        if (isExecutable(resolved)) return { path: resolved, pkg };
      } catch {
        // not resolvable as a file: fall through to the module shape
      }
      try {
        const fromModule = candidateFromModule(req(pkg));
        if (fromModule !== undefined) return { path: fromModule, pkg };
      } catch {
        // package not installed for this root: try the next one
      }
    }
  }
  return undefined;
}

const NPM_PACKAGES = {
  ffmpeg: ['@ffmpeg-installer/ffmpeg', 'ffmpeg-static'],
  ffprobe: ['@ffprobe-installer/ffprobe', 'ffprobe-static'],
};

/** Common install locations that people end up with but never add to PATH. */
function knownCandidates(kind) {
  const file = `${kind}${EXE}`;
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  if (PLATFORM === 'win32') {
    const bases = [
      'C:\\ffmpeg\\bin',
      'C:\\Program Files\\ffmpeg\\bin',
      'C:\\ProgramData\\chocolatey\\bin',
      home ? join(home, 'scoop', 'shims') : '',
    ];
    return bases.filter(Boolean).map((base) => join(base, file));
  }
  return ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/snap/bin'].map((base) => join(base, file));
}

/** PATH entries a spawn would search, for both the doctor report and error text. */
export function pathEntries() {
  return (process.env.PATH ?? '').split(PLATFORM === 'win32' ? ';' : ':').filter((entry) => entry.length > 0);
}

/**
 * Resolve one executable. `kind` is 'ffmpeg' or 'ffprobe'.
 * Returns { path, source } and throws with the full tried list when nothing matches.
 */
export function resolveBin(kind, args = {}) {
  const config = readConfig();
  const envValue = kind === 'ffmpeg'
    ? process.env.DSH_FFMPEG ?? process.env.DSH_FFMPEG_PATH ?? process.env.FFMPEG_PATH
    : process.env.DSH_FFPROBE ?? process.env.DSH_FFPROBE_PATH ?? process.env.FFPROBE_PATH;
  const envName = kind === 'ffmpeg' ? 'DSH_FFMPEG' : 'DSH_FFPROBE';
  const file = `${kind}${EXE}`;
  const tried = [];

  // 1. explicit CLI argument
  const fromCli = args[kind];
  if (typeof fromCli === 'string' && fromCli.length > 0) {
    if (!isExecutable(fromCli)) throw new Error(`resolve-bin: --${kind} "${fromCli}" is not an executable file`);
    return { path: fromCli, source: 'cli' };
  }

  // 2. environment variable
  if (typeof envValue === 'string' && envValue.length > 0) {
    if (!isExecutable(envValue)) throw new Error(`resolve-bin: ${envName} is set to "${envValue}", which is not an executable file`);
    return { path: envValue, source: 'env' };
  }
  tried.push(`env: ${envName}`);

  // 3. config file
  const fromConfig = config[kind];
  if (typeof fromConfig === 'string' && fromConfig.length > 0) {
    if (isExecutable(fromConfig)) return { path: fromConfig, source: `config ${CONFIG_PATH}` };
    tried.push(`config: ${fromConfig}`);
  } else {
    tried.push(`config: ${CONFIG_PATH}`);
  }

  // 4. vendored binary, placed by prefetch-ffmpeg.mjs or shipped by the user
  const vendorPath = join(VENDOR_DIR, file);
  if (isExecutable(vendorPath)) return { path: vendorPath, source: 'vendor' };
  tried.push(`vendor: ${vendorPath}`);

  // 5. npm packages that carry a binary
  const npm = npmCandidate(NPM_PACKAGES[kind]);
  if (npm !== undefined) return { path: npm.path, source: `npm ${npm.pkg}` };
  tried.push(`npm: ${NPM_PACKAGES[kind].join(', ')}`);

  // 6. PATH and well-known locations
  for (const entry of pathEntries()) {
    const candidate = join(entry.replace(/^"|"$/gu, ''), file);
    if (isExecutable(candidate)) return { path: candidate, source: `PATH ${entry}` };
  }
  tried.push('PATH');
  for (const candidate of knownCandidates(kind)) {
    if (isExecutable(candidate)) return { path: candidate, source: 'known location' };
  }
  tried.push('known locations');

  throw new Error([
    `resolve-bin: cannot find ${kind}. Tried:`,
    ...tried.map((line) => `  - ${line}`),
    '',
    'Fix it in one of these ways:',
    `  1. fetch it now (no admin needed): ${PREFETCH_HINT}`,
    `  2. install ffmpeg (Windows: winget install Gyan.FFmpeg | macOS: brew install ffmpeg)`,
    `  3. point at an existing copy: set ${envName}=D:\\ffmpeg\\bin\\${file}`,
    `  4. drop ${file} into ${VENDOR_DIR}`,
  ].join('\n'));
}

/** Version of the installed plugin, for the doctor header and bug reports. */
export function pluginVersion() {
  try {
    return JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The font files the sheet stamps try, in platform order. */
export function fontCandidates() {
  const win = process.env.WINDIR ?? process.env.SystemRoot ?? 'C:\\Windows';
  if (PLATFORM === 'win32') {
    return [
      join(win, 'Fonts', 'arial.ttf'),
      join(win, 'Fonts', 'segoeui.ttf'),
      join(win, 'Fonts', 'tahoma.ttf'),
    ];
  }
  if (PLATFORM === 'darwin') {
    return [
      '/System/Library/Fonts/Supplemental/Arial.ttf',
      '/System/Library/Fonts/Helvetica.ttc',
      '/Library/Fonts/Arial.ttf',
    ];
  }
  return [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ];
}

/**
 * Resolve the font for drawtext.
 * Returns `{ fragment, source }`: `fragment` is the `fontfile='…'` option or an
 * empty string, in which case ffmpeg falls back to the font it was built with
 * (fontconfig on Linux/macOS, DirectWrite on Windows). That keeps the sheets
 * rendering on a machine with no Arial instead of failing the whole filter.
 */
export function resolveFont(explicit) {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return { fragment: `fontfile='${explicit}'`, source: `--font ${explicit}` };
  }
  for (const candidate of fontCandidates()) {
    if (existsSync(candidate)) {
      const escaped = candidate.replace(/\\/gu, '/').replace(/:/gu, '\\:');
      return { fragment: `fontfile='${escaped}'`, source: candidate };
    }
  }
  return { fragment: '', source: 'ffmpeg default font' };
}

/** Human-readable report of what resolved and what the binaries can do. */
export async function doctor(run, options = {}) {
  if (options.version !== undefined) console.log(`plugin dsh-h3-motion-transfer ${options.version}`);
  // A wrong plugin root means the config, vendor and package.json anchors all
  // point somewhere else, so report it before anything else.
  console.log(`root  plugin ${pluginRoot}`);
  const font = resolveFont(options.font);
  console.log(`font  drawtext uses: ${font.source}`);

  for (const kind of ['ffmpeg', 'ffprobe']) {
    try {
      const { path, source } = resolveBin(kind);
      const version = (await run(path, ['-version'])).stdout.split(/\r?\n/u)[0];
      console.log(`ok    ${kind} [${source}] ${path}`);
      console.log(`      ${version}`);
      if (kind === 'ffmpeg') {
        const filters = (await run(path, ['-hide_banner', '-filters'])).stdout;
        const needed = ['drawtext', 'tile', 'fps', 'scale', 'select'];
        const missing = needed.filter((name) => !new RegExp(`\\b${name}\\b`, 'u').test(filters));
        console.log(missing.length === 0
          ? '      filters: drawtext, tile, fps, scale, select all present'
          : `      WARNING: this ffmpeg build is missing: ${missing.join(', ')} (install a full build; without drawtext the sheets carry no timestamps or cut labels)`);
      }
    } catch (error) {
      console.log(`FAIL  ${kind}`);
      console.log(String(error.message).split(/\r?\n/u).map((line) => `      ${line}`).join('\n'));
    }
  }
  return true;
}

/** Shared CLI options for both tools. */
export const BIN_OPTIONS = {
  ffmpeg: '--ffmpeg <path>   use this ffmpeg executable',
  ffprobe: '--ffprobe <path> use this ffprobe executable',
  font: '--font <path>     font file for the sheet timestamps',
  doctor: '--doctor         report which ffmpeg/ffprobe resolve, then exit',
};
