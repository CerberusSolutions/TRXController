import { contextBridge } from 'electron';

// The renderer only ever sees this object. Serial and logging IPC is added
// here in later sessions; nothing in the renderer may require Node modules.
const api = {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
};

export type TrxApi = typeof api;

contextBridge.exposeInMainWorld('trx', api);
