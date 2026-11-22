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

export interface BebeatElectronAPI {
  isElectron: boolean;
  getCapabilities: () => Promise<SystemCapabilities>;
  readAssetBinary: (relPath: string) => Promise<Uint8Array>;
  readAssetJson: (relPath: string) => Promise<unknown>;
  runPython: (code: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  transcodeSave: (req: {
    wavBytes: Uint8Array;
    outputPath: string;
    format: string;
    sampleRate: number;
    dither: string;
    truePeakCeilingDb: number;
  }) => Promise<{ ok: boolean; path: string; bytes: number; error?: string }>;
  saveProject: (defaultName: string, json: string) => Promise<string | null>;
  openProject: () => Promise<{ path: string; json: string } | null>;
  pickExportPath: (defaultName: string, ext: string) => Promise<string | null>;
  pickExportFolder: () => Promise<string | null>;
  pickAudioOrSf2: () => Promise<{ name: string; path: string; bytes: Uint8Array } | null>;
  saveBinary: (defaultName: string, ext: string, bytes: Uint8Array) => Promise<string | null>;
}

declare global {
  interface Window {
    bebeat?: BebeatElectronAPI;
  }
}

export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.bebeat?.isElectron);
}

export async function getSystemCapabilities(): Promise<SystemCapabilities> {
  if (window.bebeat) {
    return window.bebeat.getCapabilities();
  }
  return {
    platform: 'browser',
    isPackaged: false,
    resourceRoot: './assets',
    assetsDir: './assets',
    ffmpegAvailable: false,
    ffmpegPath: null,
    pythonAvailable: false,
    pythonVersion: 'Embedded JS-Py Runtime',
    wasapiSupported: false,
  };
}

export async function loadAssetBinary(relPath: string): Promise<ArrayBuffer> {
  if (window.bebeat) {
    const bytes = await window.bebeat.readAssetBinary(relPath);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }
  const resp = await fetch(`./assets/${relPath}`);
  if (!resp.ok) throw new Error(`Failed to fetch asset ./assets/${relPath}`);
  return resp.arrayBuffer();
}

export async function loadAssetJson<T = unknown>(relPath: string): Promise<T> {
  if (window.bebeat) {
    return (await window.bebeat.readAssetJson(relPath)) as T;
  }
  const resp = await fetch(`./assets/${relPath}`);
  if (!resp.ok) throw new Error(`Failed to fetch JSON ./assets/${relPath}`);
  return (await resp.json()) as T;
}

export function triggerBrowserDownload(filename: string, data: Uint8Array | string, mime = 'application/octet-stream'): void {
  const blob =
    typeof data === 'string'
      ? new Blob([data], { type: mime })
      : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
