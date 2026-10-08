// Fresh, frame-accurate extraction of one source clip into a review set.
// Writes: frames/f_%04d.png (each stamped with its index and in-frame timestamp),
// frame-index.txt (source seconds -> file), whole-clip contact sheets, and an
// optional motion preview. The output directory is deleted first, so a rerun can
// never reuse stale frames.
//
// Usage:
//   node frames.mjs --video <path> --out <dir> [--fps 8] [--scale 448] [--cols 4]
//                   [--rows 3] [--start 0] [--duration 5.5] [--motion 16]
//                   [--force] [--ffmpeg <path>] [--ffprobe <path>] [--doctor]
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rm, readdir, writeFile } from 'node:fs/promises';
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
if (video === undefined) throw new Error('frames: --video is required');
const outDir = args.out ?? 'frames-out';
// Collision guard: never delete and overwrite a previous run's evidence silently.
// Two source clips can share one BaseName (for example 01_x.mp4 and 01_clean.mp4),
// and a batch loop that reuses the folder would otherwise lose the first set.
if (existsSync(outDir) && !flagOn(args.force)) {
  const files = readdirSync(outDir, { recursive: true }).filter((entry) => !String(entry).endsWith('.'));
  if (files.length > 0) {
    throw new Error([
      `frames: ${outDir} already holds ${files.length} entries from an earlier run.`,
      'Give this clip its own --out folder, or pass --force to replace it.',
      'A batch that reuses one folder for clips with the same BaseName keeps only the last clip.',
    ].join('\n'));
  }
}
const { path: FFMPEG } = resolveBin('ffmpeg', args);
const { path: FFPROBE } = resolveBin('ffprobe', args);
const fps = Number(args.fps ?? 8);
const scale = Number(args.scale ?? 448);
const cols = Number(args.cols ?? 4);
const rows = Number(args.rows ?? 3);
const start = Number(args.start ?? 0);
const durationArg = args.duration === undefined ? undefined : Number(args.duration);
const motion = args.motion === undefined ? undefined : Number(args.motion);
const perSheet = cols * rows;
// The font file is chosen per platform; an empty fragment leaves ffmpeg on its
// own default font so a machine without Arial still renders the sheets.
const { fragment: fontOption, source: fontSource } = resolveFont(typeof args.font === 'string' ? args.font : undefined);

const ffprobe = async (entries, stream = 'v:0') =>
  (await run(FFPROBE, ['-v', 'error', '-select_streams', stream, '-show_entries', entries, '-of', 'default=noprint_wrappers=1:nokey=1', video])).stdout.trim();

const rawFps = await ffprobe('stream=r_frame_rate');
const [num, den] = rawFps.split('/').map(Number);
const srcFps = den ? num / den : num;
const containerDuration = Number(await ffprobe('format=duration', 'v:0'));
const clipDuration = durationArg ?? Math.max(0, containerDuration - start);
const expected = Math.round(clipDuration * fps);

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'frames'), { recursive: true });

const seek = start > 0 ? ['-ss', String(start)] : [];
const clip = durationArg === undefined ? [] : ['-t', String(durationArg)];
const frameVf = [
  `fps=${fps}`,
  `scale=${scale}:-2:flags=lanczos`,
  `drawtext=${fontOption ? `${fontOption}:` : ''}text='%{eif\\:n\\:d} | %{pts\\:hms}':x=6:y=6:fontsize=15:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4`,
].join(',');

await run(FFMPEG, [
  '-hide_banner', '-loglevel', 'error', '-y',
  ...seek, '-i', video, ...clip,
  '-vf', frameVf, '-fps_mode', 'passthrough',
  join(outDir, 'frames', 'f_%04d.png'),
]);

const frames = (await readdir(join(outDir, 'frames'))).filter((f) => f.endsWith('.png')).sort();
const sheets = Math.ceil(frames.length / perSheet);

const lines = [
  `video=${video}`,
  `extracted_at=${new Date().toISOString()}`,
  `source_fps=${srcFps} container_duration=${containerDuration} clip_start=${start} clip_duration=${clipDuration}`,
  `review_fps=${fps} expected_frames=${expected} extracted_frames=${frames.length}`,
  'frame_times: index -> source seconds (index 1 = first extracted frame)',
  ...frames.map((f, i) => `${String(i + 1).padStart(4, '0')}  ${(start + i / fps).toFixed(3)}s  ${f}`),
];
await writeFile(join(outDir, 'frame-index.txt'), lines.join('\n') + '\n', 'utf8');

for (let s = 0; s < sheets; s++) {
  const first = s * perSheet + 1;
  const count = Math.min(perSheet, frames.length - s * perSheet);
  const suffix = count < perSheet ? `:nb_frames=${count}` : '';
  const label = `sheet ${s + 1}/${sheets}  ${cols}x${rows}  step ${(1 / fps).toFixed(3)}s  from ${(start + (s * perSheet) / fps).toFixed(3)}s`;
  const vf = `tile=${cols}x${rows}:padding=6:color=0x202020${suffix},drawtext=${fontOption ? `${fontOption}:` : ''}text='${label}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=6`;
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-start_number', String(first),
    '-i', join(outDir, 'frames', 'f_%04d.png'),
    '-vf', vf, '-frames:v', '1',
    join(outDir, `sheet_${String(s + 1).padStart(2, '0')}.png`),
  ]);
}

if (motion !== undefined && motion > 0) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...seek, '-i', video, ...clip,
    '-vf', `fps=${motion},scale=576:-2:flags=lanczos`,
    '-c:v', 'libwebp_anim', '-loop', '0', '-q:v', '60',
    join(outDir, 'motion_preview.webp'),
  ]).catch(() => undefined);
}

const lastSampled = frames.length === 0 ? null : Number((start + (frames.length - 1) / fps).toFixed(3));
const report = {
  video, outDir, srcFps, clipStart: start, clipDuration, fps,
  expectedFrames: expected, extractedFrames: frames.length, sheets,
  lastSampledTimestamp: lastSampled,
  coverageComplete: frames.length >= expected,
};
console.log(JSON.stringify(report, undefined, 2));
if (!report.coverageComplete) {
  console.log(`note: ${expected - frames.length} sampled frame(s) at the tail fall outside the clip; review covers up to ${lastSampled}s of ${Number((start + clipDuration).toFixed(3))}s.`);
}
