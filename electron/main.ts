import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  probeCapabilities,
  readAssetBinary,
  readAssetJson,
  renderWindowsSapiWav,
  runLocalPythonScript,
  transcodeAndSaveAudio,
  type ExportTranscodeRequest,
} from './backend';

// Configure low-latency Windows WASAPI audio and enable SharedArrayBuffer / Web MIDI
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer,AudioServiceOutOfProcess');
  if (process.env.BEBEAT_WASAPI_EXCLUSIVE === '1') {
    app.commandLine.appendSwitch('enable-exclusive-audio');
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1580,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#080C18',
    title: 'Bebeat',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Inject COOP/COEP headers so SharedArrayBuffer lock-free AudioWorklet telemetry is active
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = {
      ...details.responseHeaders,
      'Cross-Origin-Opener-Policy': ['same-origin'],
      'Cross-Origin-Embedder-Policy': ['require-corp'],
    };
    callback({ responseHeaders: headers });
  });

  // Grant Web MIDI & audio permissions automatically for hardware controllers
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'midi' || permission === 'midiSysex' || permission === 'media') {
      callback(true);
      return;
    }
    callback(false);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/app.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('bebeat:capabilities', () => probeCapabilities());
  ipcMain.handle('bebeat:read-asset-bin', (_e, rel: string) => readAssetBinary(rel));
  ipcMain.handle('bebeat:read-asset-json', (_e, rel: string) => readAssetJson(rel));
  ipcMain.handle('bebeat:run-python', (_e, code: string) => runLocalPythonScript(code));
  ipcMain.handle('bebeat:render-sapi-tts', (_e, text: string, rate: number) => renderWindowsSapiWav(text, rate));
  ipcMain.handle('bebeat:transcode-save', (_e, req: ExportTranscodeRequest) => transcodeAndSaveAudio(req));

  ipcMain.handle('bebeat:save-project', async (_e, defaultName: string, json: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Save Bebeat Project',
      defaultPath: defaultName,
      filters: [{ name: 'Bebeat Project', extensions: ['bebeat', 'json'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fs.writeFile(res.filePath, json, 'utf-8');
    return res.filePath;
  });

  ipcMain.handle('bebeat:open-project', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Open Bebeat Project',
      properties: ['openFile'],
      filters: [{ name: 'Bebeat Project', extensions: ['bebeat', 'json'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const text = await fs.readFile(res.filePaths[0], 'utf-8');
    return { path: res.filePaths[0], json: text };
  });

  ipcMain.handle('bebeat:pick-export-path', async (_e, defaultName: string, ext: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Export Lossless Audio',
      defaultPath: defaultName,
      filters: [
        { name: `${ext.toUpperCase()} Audio`, extensions: [ext] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return res.canceled ? null : res.filePath;
  });

  ipcMain.handle('bebeat:pick-export-folder', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Select Folder for Stem Batch Export',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  ipcMain.handle('bebeat:pick-audio-or-sf2', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Import Music / Sample (.mp3/.wav/.flac/.ogg/.m4a), SoundFont (.sf2) or MIDI (.mid)',
      properties: ['openFile'],
      filters: [
        { name: 'Audio, SoundFont & MIDI', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'sf2', 'mid', 'midi'] },
      ],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    const buf = await fs.readFile(filePath);
    return { name: path.basename(filePath), path: filePath, bytes: new Uint8Array(buf) };
  });

  ipcMain.handle('bebeat:save-binary', async (_e, defaultName: string, ext: string, bytes: Uint8Array) => {
    const res = await dialog.showSaveDialog({
      title: `Save ${ext.toUpperCase()} File`,
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fs.writeFile(res.filePath, Buffer.from(bytes));
    return res.filePath;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
