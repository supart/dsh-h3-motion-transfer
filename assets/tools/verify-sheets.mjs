// Build the human-checkable process mosaic for one source clip: an overview
// sheet whose every cell carries a frame index, an in-frame timestamp and its
// shot label, plus native-rate boundary sheets around each cut.
//
// Usage:
//   node verify-sheets.mjs --video <path> --out <dir> --shot 0-1.750:SHOT1
//        [--shot 1.750-2.750:SHOT2 ...] [--fps 24] [--boundary 0.35] [--scale 640]
//        [--start 0] [--duration 5.5] [--overviewFps 4] [--font <path>]
//        [--ffmpeg <path>] [--ffprobe <path>] [--doctor]
//   A clip with a single --shot has no cut, so the tool writes A_overview.png
//   (and C_shot_starts.png) only; it reports boundarySheets: 0 instead of failing.
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BIN_OPTIONS, doctor, flagOn, parseArgs, pluginVersion, resolveBin, resolveFont } from './lib/resolve-bin.mjs';

const run = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
if (flagOn(args.doctor)) {
  await doctor(run, { font: typeof args.font === 'string' ? args.font : undefined, version: pluginVersion() });
  process.exit(0);
}
const video = args.video;
if (video === undefined) throw new Error('verify-sheets: --video is required');
if (args.shot.length === 0) throw new Error('verify-sheets: at least one --shot <start>-<end>:<label> is required');
const { path: FFMPEG } = resolveBin('ffmpeg', args);
const { path: FFPROBE } = resolveBin('ffprobe', args);

const outDir = args.out ?? 'verify-out';
const fps = Number(args.fps ?? 24);
const boundary = Number(args.boundary ?? 0.35);
const scale = Number(args.scale ?? 640);
const start = Number(args.start ?? 0);
const durationArg = args.duration === undefined ? undefined : Number(args.duration);
// The font file is chosen per platform; an empty fragment leaves ffmpeg on its
// own default font so a machine without Arial still renders the sheets.
const { fragment: fontOption, source: fontSource } = resolveFont(typeof args.font === 'string' ? args.font : undefined);

const shots = args.shot.map((spec) => {
  const parsed = /^(-?[\d.]+)-(-?[\d.]+):(.+)$/u.exec(spec);
  if (parsed === null) throw new Error(`verify-sheets: bad --shot "${spec}", expected <start>-<end>:<label>`);
  const [, a, b, label] = parsed;
  return { start: Number(a), end: Number(b), label: label.trim() };
});
const clipStart = shots[0].start;
const clipEnd = shots[shots.length - 1].end;
const clipDuration = durationArg ?? clipEnd - clipStart;

const probe = async (entries) =>
  (await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'default=noprint_wrappers=1:nokey=1', video])).stdout.trim();

const srcFpsRaw = await probe('stream=r_frame_rate');
const [num, den] = srcFpsRaw.split('/').map(Number);
const srcFps = den ? num / den : num;
const frameDuration = 1 / srcFps;
const sourceFrameCount = Math.round((await probe('stream=nb_frames')) || 0);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const seek = start + clipStart > 0 ? ['-ss', String(start + clipStart)] : [];
const clip = ['-t', String(clipDuration)];

/** ffmpeg expression: the shot label that a frame at time `t` belongs to. */
function shotFilter(timeExpr) {
  const terms = shots.map((s, i) => {
    const color = ['0x8CFF5A', '0xFFD60A', '0x64D2FF', '0xFF9F0A', '0xBF5AF2'][i % 5];
    const window = `gte(${timeExpr}\\,${s.start.toFixed(3)})*lt(${timeExpr}\\,${s.end.toFixed(3)})`;
    return `drawtext=${fontOption ? `${fontOption}:` : ''}text='${s.label}':x=8:y=44:fontsize=18:fontcolor=${color}:box=1:boxcolor=black@0.75:boxborderw=5:enable='${window}'`;
  });
  const cuts = shots.slice(1).map((s) => {
    const t = s.start;
    const hit = `gte(${timeExpr}\\,${(t - frameDuration / 2).toFixed(4)})*lt(${timeExpr}\\,${(t + frameDuration / 2).toFixed(4)})`;
    return [
      `drawbox=x=0:y=0:w=iw:h=ih:color=0xFF3B30@0.95:t=6:enable='${hit}'`,
      `drawtext=${fontOption ? `${fontOption}:` : ''}text='CUT -> ${s.label} at ${t.toFixed(3)}s':x=8:y=76:fontsize=18:fontcolor=0xFF3B30:box=1:boxcolor=black@0.75:boxborderw=5:enable='${hit}'`,
    ].join(',');
  });
  return [...terms, ...cuts].join(',');
}

const stamp = `drawtext=${fontOption ? `${fontOption}:` : ''}text='n=%{eif\\:n\\:d}  %{pts\\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=5`;

// Overview: whole clip at a readable step, cut cells boxed in red.
// The overview tile is a fixed 4x6 grid, so long clips get a coarser step rather
// than an overflowing sheet: the step is chosen to fit at most 24 cells.
const overviewGridCells = 24;
const autoOverviewFps = clipDuration <= overviewGridCells
  ? 4
  : Number((overviewGridCells / clipDuration).toFixed(2));
const overviewFps = Number(args.overviewFps ?? autoOverviewFps);
const overviewVf = [
  `fps=${overviewFps}`,
  `scale=${scale}:-2:flags=lanczos`,
  stamp,
  shotFilter('t'),
  `tile=4x6:padding=8:color=0x101010`,
].join(',');
const overviewPath = join(outDir, 'A_overview.png');
await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...seek, '-i', video, ...clip, '-vf', overviewVf, '-frames:v', '1', overviewPath]);

// Boundary sheets: native rate around each cut (none for a single-shot clip).
const boundaryFiles = [];
const boundarySheets = shots.length - 1;
for (let i = 1; i < shots.length; i++) {
  const cut = shots[i].start;
  const from = Math.max(clipStart, cut - boundary);
  const to = Math.min(clipEnd, cut + boundary);
  const vf = [
    `select='between(t,${from.toFixed(4)},${to.toFixed(4)})'`,
    `scale=${Math.round(scale * 0.8)}:-2:flags=lanczos`,
    stamp,
    shotFilter('t'),
    `tile=6x3:padding=6:color=0x101010`,
  ].join(',');
  const file = join(outDir, `B_cut${i}_${cut.toFixed(3)}s.png`);
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', video, '-vf', vf, '-frames:v', '1', file]);
  boundaryFiles.push(file);
}

// Whole-frame still of the first frame of every shot, for orientation.
const stillVf = [`scale=${scale}:-2:flags=lanczos`, stamp, shotFilter('t'), `tile=${Math.min(4, shots.length)}x1:padding=6:color=0x101010`];
const stillSelect = shots.map((s) => `eq(t\\,${s.start.toFixed(4)})`).join('+');
const stillPath = join(outDir, 'C_shot_starts.png');
await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...seek, '-i', video, ...clip, '-vf', `select='${stillSelect}',${stillVf}`, '-frames:v', '1', stillPath]).catch(() => undefined);

const manifest = {
  video,
  generated_at: new Date().toISOString(),
  source_fps: srcFps,
  source_frame_count: sourceFrameCount,
  clip_start: start + clipStart,
  clip_duration: clipDuration,
  overview_fps: overviewFps,
  overview_cells: Math.min(overviewGridCells, Math.max(1, Math.round(clipDuration * overviewFps))),
  shot_count: shots.length,
  boundary_sheets: boundarySheets,
  cut_times: shots.slice(1).map((s) => s.start),
  shots,
  files: ['A_overview.png', ...boundaryFiles.map((f) => f.split(/[\\/]/u).pop()), 'C_shot_starts.png'],
};
await writeFile(join(outDir, 'verify-manifest.json'), JSON.stringify(manifest, undefined, 2) + '\n', 'utf8');
console.log(JSON.stringify(manifest, undefined, 2));
