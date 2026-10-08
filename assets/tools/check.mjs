// Health check for the dsh-h3-motion-transfer plugin. Run it after installing:
//
//   npx dsh-h3-motion-check
//   node assets/tools/check.mjs
//
// It reports the plugin version, the drawtext font in use, whether ffmpeg and
// ffprobe resolve (and from where), and whether that ffmpeg build carries the
// filters the review sheets need. Exit code is 1 when either binary is missing.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VENDOR_DIR, doctor, parseArgs, pluginVersion, resolveBin, resolveFont } from './lib/resolve-bin.mjs';

const run = promisify(execFile);
const args = parseArgs(process.argv.slice(2));

console.log('dsh-h3-motion-transfer health check');
console.log(`skill name : h3-compact-motion-transfer`);
console.log(`vendor dir : ${VENDOR_DIR}`);
const font = resolveFont(typeof args.font === 'string' ? args.font : undefined);
console.log(`drawtext   : ${font.source}`);
console.log('');

// doctor() prints its own report but swallows per-binary failures, so probe the
// binaries here as well to produce the exit code.
const outcomes = ['ffmpeg', 'ffprobe'].map((kind) => {
  try {
    const { path, source } = resolveBin(kind, args);
    return { kind, ok: true, path, source };
  } catch (error) {
    return { kind, ok: false, message: String(error.message).split(/\r?\n/u)[0] };
  }
});

await doctor(run, { font: typeof args.font === 'string' ? args.font : undefined, version: pluginVersion() });

const failed = outcomes.filter((outcome) => !outcome.ok);
console.log('');
if (failed.length > 0) {
  console.log(`RESULT: ${failed.length} of 2 binaries missing (${failed.map((f) => f.kind).join(', ')}).`);
  console.log('Run the prefetcher to install them without admin rights:');
  console.log('  node assets/tools/prefetch-ffmpeg.mjs');
  process.exit(1);
}
console.log('RESULT: ready. Both binaries resolve and the sheet filters are present.');
