import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const desktopDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceDirectory = join(desktopDirectory, '../../.impeccable/review/desktop-d0');
const executable =
  process.env.CUEWEAVE_D0_EXECUTABLE ??
  join(desktopDirectory, 'dist/package/win-unpacked/CueWeave.exe');
const packageDirectory = resolve(executable, '..');
const fixtureDirectory = join(desktopDirectory, '../../.fixtures/desktop');
const fixtures = {
  mp4: join(fixtureDirectory, 'D0 H264 AAC 中文.mp4'),
  webm: join(fixtureDirectory, 'D0 VP9 Opus sample.webm'),
  mkv: join(fixtureDirectory, 'D0 HEVC multi audio.mkv'),
  vfr: join(fixtureDirectory, 'D0 variable frame rate.mp4'),
  offset: join(fixtureDirectory, 'D0 nonzero start.mkv'),
  corrupt: join(fixtureDirectory, 'D0 corrupt.mp4'),
};
await mkdir(evidenceDirectory, { recursive: true });
await mkdir(fixtureDirectory, { recursive: true });
await stat(executable);

const ffmpeg = require('ffmpeg-static');
async function generate(args) {
  await execFileAsync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    windowsHide: true,
  });
}
await generate([
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=640x360:rate=30',
  '-f',
  'lavfi',
  '-i',
  'anullsrc=channel_layout=stereo:sample_rate=48000',
  '-t',
  '3',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-movflags',
  '+faststart',
  fixtures.mp4,
]);
await generate([
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=640x360:rate=24',
  '-f',
  'lavfi',
  '-i',
  'anullsrc=channel_layout=stereo:sample_rate=48000',
  '-t',
  '3',
  '-c:v',
  'libvpx-vp9',
  '-deadline',
  'realtime',
  '-c:a',
  'libopus',
  fixtures.webm,
]);
await generate([
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=320x180:rate=24',
  '-f',
  'lavfi',
  '-i',
  'anullsrc=channel_layout=stereo:sample_rate=48000',
  '-f',
  'lavfi',
  '-i',
  'anullsrc=channel_layout=stereo:sample_rate=48000',
  '-t',
  '2',
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-map',
  '2:a',
  '-c:v',
  'libx265',
  '-preset',
  'ultrafast',
  '-x265-params',
  'log-level=error',
  '-c:a',
  'aac',
  fixtures.mkv,
]);
await generate([
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=320x180:rate=24:duration=1.5',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=320x180:rate=12:duration=1.5',
  '-filter_complex',
  '[0:v][1:v]concat=n=2:v=1:a=0',
  '-fps_mode',
  'vfr',
  '-c:v',
  'libx264',
  fixtures.vfr,
]);
await generate(['-itsoffset', '2', '-i', fixtures.mp4, '-c', 'copy', fixtures.offset]);
await writeFile(fixtures.corrupt, Buffer.from('not a media file\n'.repeat(64)));

const isolated = await mkdtemp(join(tmpdir(), 'cueweave-d0-'));
const testUserData = join(isolated, 'user-data');
const resultPath = join(testUserData, 'd0-acceptance.json');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_PATH;
delete env.npm_config_prefix;
env.Path = `${env.SystemRoot ?? 'C:\\Windows'}\\System32;${env.SystemRoot ?? 'C:\\Windows'}`;
env.CUEWEAVE_TEST_USER_DATA = testUserData;

const child = spawn(
  executable,
  [
    ...Object.values(fixtures).map((fixture) => `--d0-check-input=${fixture}`),
    '--d0-check',
    '--mute-audio',
    '--disable-gpu-sandbox',
  ],
  { cwd: isolated, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});
const exitCode = await new Promise((resolveCode, reject) => {
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('Packaged D0 check timed out'));
  }, 45_000);
  child.once('error', reject);
  child.once('exit', (code) => {
    clearTimeout(timer);
    resolveCode(code);
  });
});
assert.equal(exitCode, 0, `Packaged app failed.\n${stdout}\n${stderr}`);
const result = JSON.parse(await readFile(resultPath, 'utf8'));
assert.equal(result.packaged, true);
assert.equal(result.storage.reopened, true);
assert.equal(result.cancellation.cancelled, true);
assert.ok(result.extractedBytes > 44);
const range = Object.fromEntries(result.ranges.map((value) => [value.name, value]));
const mp4Bytes = (await stat(fixtures.mp4)).size;
assert.deepEqual([range.full.status, range.full.length], [200, mp4Bytes]);
assert.deepEqual([range.first.status, range.first.length], [206, 64]);
assert.match(range.first.contentRange, /^bytes 0-63\/\d+$/);
assert.deepEqual([range.suffix.status, range.suffix.length], [206, 32]);
assert.deepEqual([range.multi.status, range.multi.length], [416, 0]);
assert.deepEqual([range.outside.status, range.outside.length], [416, 0]);
assert.deepEqual(
  [range.head.status, range.head.length, Number(range.head.contentLength)],
  [200, 0, mp4Bytes],
);
const probes = Object.fromEntries(result.probes.map((value) => [value.name, value]));
assert.ok(
  probes['D0 H264 AAC 中文.mp4'].value.tracks.some(
    (track) => track.type === 'video' && track.codec === 'h264',
  ),
);
assert.ok(
  probes['D0 VP9 Opus sample.webm'].value.tracks.some(
    (track) => track.type === 'audio' && track.codec === 'opus',
  ),
);
assert.equal(
  probes['D0 HEVC multi audio.mkv'].value.tracks.filter((track) => track.type === 'audio').length,
  2,
);
assert.ok(
  probes['D0 variable frame rate.mp4'].value.tracks.some((track) => track.type === 'video'),
);
assert.ok(probes['D0 nonzero start.mkv'].value.startTimeSeconds >= 1.9);
assert.equal(probes['D0 corrupt.mp4'].ok, false);
assert.equal(result.restarted.generation, result.first.generation + 1);

await new Promise((resolveWait) => setTimeout(resolveWait, 500));
for (const pid of [result.first.pid, result.restarted.pid]) {
  assert.throws(
    () => process.kill(pid, 0),
    undefined,
    `Background process ${pid} survived app exit`,
  );
}

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
const evidence = {
  checkedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  reducedPath: env.Path,
  fixtures: await Promise.all(
    Object.values(fixtures).map(async (fixture) => ({
      name: fixture.split(/[\\/]/).at(-1),
      sha256: await sha256(fixture),
    })),
  ),
  artifacts: {
    executableSha256: await sha256(executable),
    ffmpegSha256: await sha256(join(packageDirectory, 'resources/tools/ffmpeg.exe')),
    ffprobeSha256: await sha256(join(packageDirectory, 'resources/tools/ffprobe.exe')),
  },
  result,
  processCleanup: 'passed',
};
const evidenceName = process.env.CUEWEAVE_D0_EVIDENCE ?? 'acceptance.json';
await writeFile(join(evidenceDirectory, evidenceName), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(
  'Packaged D0 acceptance passed: media matrix, SQLite reopen, extraction, cancellation, restart, and process cleanup.\n',
);
