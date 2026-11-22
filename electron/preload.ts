import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bebeat', {
  isElectron: true,
  getCapabilities: () => ipcRenderer.invoke('bebeat:capabilities'),
  readAssetBinary: (relPath: string) => ipcRenderer.invoke('bebeat:read-asset-bin', relPath),
  readAssetJson: (relPath: string) => ipcRenderer.invoke('bebeat:read-asset-json', relPath),
  runPython: (code: string) => ipcRenderer.invoke('bebeat:run-python', code),
  renderSapiTts: (text: string, rate: number) => ipcRenderer.invoke('bebeat:render-sapi-tts', text, rate),
  transcodeSave: (req: unknown) => ipcRenderer.invoke('bebeat:transcode-save', req),
  saveProject: (defaultName: string, json: string) => ipcRenderer.invoke('bebeat:save-project', defaultName, json),
  openProject: () => ipcRenderer.invoke('bebeat:open-project'),
  pickExportPath: (defaultName: string, ext: string) => ipcRenderer.invoke('bebeat:pick-export-path', defaultName, ext),
  pickExportFolder: () => ipcRenderer.invoke('bebeat:pick-export-folder'),
  pickAudioOrSf2: () => ipcRenderer.invoke('bebeat:pick-audio-or-sf2'),
  saveBinary: (defaultName: string, ext: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('bebeat:save-binary', defaultName, ext, bytes),
});
