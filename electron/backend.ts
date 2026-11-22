import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPathRaw from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

export function resolveAppResourceRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, '..');
}

export function resolveAssetsDir(): string {
  return path.join(resolveAppResourceRoot(), 'assets');
}

export function resolvePythonBridgePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'scripts', 'python_bridge.py');
  }
  return path.join(resolveAppResourceRoot(), 'scripts', 'python_bridge.py');
}

export function resolveFfmpegBinary(): string | null {
  if (!ffmpegPathRaw) return null;
  // When packaged with asarUnpack, ffmpeg-static sits inside app.asar.unpacked
  const unpacked = ffmpegPathRaw.replace('app.asar', 'app.asar.unpacked');
  if (fsSync.existsSync(unpacked)) return unpacked;
  if (fsSync.existsSync(ffmpegPathRaw)) return ffmpegPathRaw;
  return null;
}

export interface SystemCapabilities {
  platform: string;
  isPackaged: boolean;
  resourceRoot: string;
  assetsDir: string;
  ffmpegAvailable: boolean;
  ffmpegPath: string | null;
  pythonAvailable: boolean;
  pythonVersion: string | null;
  wasapiSupported: boolean;
}

export async function probeCapabilities(): Promise<SystemCapabilities> {
  const ffmpeg = resolveFfmpegBinary();
  let pythonVersion: string | null = null;
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, ['--version'], { timeout: 3000 });
      const text = (stdout || stderr || '').trim();
      if (text.toLowerCase().includes('python')) {
        pythonVersion = text;
        break;
      }
    } catch {
      // try next
    }
  }

  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    resourceRoot: resolveAppResourceRoot(),
    assetsDir: resolveAssetsDir(),
    ffmpegAvailable: Boolean(ffmpeg),
    ffmpegPath: ffmpeg,
    pythonAvailable: Boolean(pythonVersion),
    pythonVersion,
    wasapiSupported: process.platform === 'win32',
  };
}

export async function readAssetBinary(relativePath: string): Promise<Uint8Array> {
  const safeRel = relativePath.replace(/^[/\\]+/, '').replace(/\.\./g, '');
  const fullPath = path.join(resolveAssetsDir(), safeRel);
  const buf = await fs.readFile(fullPath);
  return new Uint8Array(buf);
}

export async function readAssetJson(relativePath: string): Promise<unknown> {
  const safeRel = relativePath.replace(/^[/\\]+/, '').replace(/\.\./g, '');
  const fullPath = path.join(resolveAssetsDir(), safeRel);
  const text = await fs.readFile(fullPath, 'utf-8');
  return JSON.parse(text);
}

export interface ExportTranscodeRequest {
  wavBytes: Uint8Array;
  outputPath: string;
  format: 'wav32f' | 'wav24' | 'wav16' | 'flac' | 'aiff' | 'mp3' | 'ogg';
  sampleRate: number;
  dither: 'none' | 'tpdf' | 'shaped';
  truePeakCeilingDb: number;
}

export async function transcodeAndSaveAudio(req: ExportTranscodeRequest): Promise<{ ok: boolean; path: string; bytes: number; error?: string }> {
  try {
    await fs.mkdir(path.dirname(req.outputPath), { recursive: true });
    // WAV formats are already sample-accurately rendered & dithered in our offline DSP renderer
    if (req.format === 'wav32f' || req.format === 'wav24' || req.format === 'wav16') {
      await fs.writeFile(req.outputPath, Buffer.from(req.wavBytes));
      const stat = await fs.stat(req.outputPath);
      return { ok: true, path: req.outputPath, bytes: stat.size };
    }

    const ffmpeg = resolveFfmpegBinary();
    if (!ffmpeg) {
      return { ok: false, path: req.outputPath, bytes: 0, error: 'FFmpeg binary not available for transcoding' };
    }

    const tmpIn = path.join(os.tmpdir(), `bebeat_render_${Date.now()}.wav`);
    await fs.writeFile(tmpIn, Buffer.from(req.wavBytes));

    const args: string[] = ['-y', '-i', tmpIn, '-ar', String(req.sampleRate)];
    if (req.format === 'flac') {
      args.push('-c:a', 'flac', '-compression_level', '8', '-sample_fmt', 's32');
    } else if (req.format === 'aiff') {
      args.push('-c:a', 'pcm_s24be');
    } else if (req.format === 'mp3') {
      args.push('-c:a', 'libmp3lame', '-b:a', '320k');
    } else if (req.format === 'ogg') {
      args.push('-c:a', 'libvorbis', '-q:a', '8');
    }
    args.push(req.outputPath);

    try {
      await execFileAsync(ffmpeg, args, { timeout: 120000 });
      const stat = await fs.stat(req.outputPath);
      return { ok: true, path: req.outputPath, bytes: stat.size };
    } finally {
      await fs.unlink(tmpIn).catch(() => {});
    }
  } catch (err) {
    return {
      ok: false,
      path: req.outputPath,
      bytes: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runLocalPythonScript(code: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const bridgeScript = resolvePythonBridgePath();
  if (!fsSync.existsSync(bridgeScript)) {
    return { ok: false, error: `Python bridge script not found at ${bridgeScript}` };
  }

  const runCmd = (cmd: string) =>
    new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
      const child = spawn(cmd, [bridgeScript], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve({ ok: false, error: 'Python execution timed out (8s limit)' });
      }, 8000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf-8');
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        if (exitCode !== 0 && !stdout.trim()) {
          resolve({ ok: false, error: stderr.trim() || `Python exited with code ${exitCode}` });
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.ok) {
            resolve({ ok: true, data: parsed });
          } else {
            resolve({ ok: false, error: parsed.error || 'Python execution error' });
          }
        } catch {
          resolve({ ok: false, error: stderr.trim() || `Invalid JSON from Python: ${stdout.slice(0, 200)}` });
        }
      });

      child.stdin.write(code, 'utf-8');
      child.stdin.end();
    });

  for (const cmd of ['python', 'python3', 'py']) {
    const res = await runCmd(cmd);
    if (res.ok || !res.error?.includes('ENOENT')) {
      return res;
    }
  }
  return { ok: false, error: 'No local Python 3 interpreter found in PATH' };
}

/**
 * Renders classic Windows SAPI Text-to-Speech (Microsoft David / Zira) directly into a WAV byte buffer
 * via built-in System.Speech.Synthesis so users can chop, pitch-shift, and sample classic Windows TTS voices.
 */
export async function renderWindowsSapiWav(
  text: string,
  rate = 0
): Promise<{ ok: boolean; bytes?: Uint8Array; error?: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Windows SAPI TTS is only available on Windows' };
  }
  const cleanText = text.replace(/[\r\n]+/g, ' ').trim().slice(0, 400);
  if (!cleanText) return { ok: false, error: 'Empty text' };
  const clampedRate = Math.max(-8, Math.min(8, Math.round(rate)));
  const tmpWav = path.join(os.tmpdir(), `bebeat_tts_${Date.now()}.wav`);

  const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = ${clampedRate}
$synth.SetOutputToWaveFile('${tmpWav.replace(/'/g, "''")}')
$synth.Speak($env:BEBEAT_TTS_TEXT)
$synth.Dispose()
`;

  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psScript], {
      timeout: 12000,
      env: { ...process.env, BEBEAT_TTS_TEXT: cleanText },
    });
    const buf = await fs.readFile(tmpWav);
    return { ok: true, bytes: new Uint8Array(buf) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await fs.unlink(tmpWav).catch(() => {});
  }
}
