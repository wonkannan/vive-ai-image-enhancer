'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, typed API surface to the renderer process.
// No raw ipcRenderer is exposed — only these explicit methods.
contextBridge.exposeInMainWorld('electronAPI', {

  // ── Invoke main-process actions (return Promises) ──────────────────────

  /** Opens the native folder-picker dialog. Returns the chosen path or null. */
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  /**
   * Starts batch image processing.
   * @param {{ folderPath: string, quality: string, apiKey: string }} opts
   */
  startProcessing: (opts) => ipcRenderer.invoke('start-processing', opts),

  /** Requests cancellation of the current batch. */
  cancelProcessing: () => ipcRenderer.invoke('cancel-processing'),

  // ── Subscribe to events pushed from main process ───────────────────────

  /**
   * Registers a listener for log messages streamed from the processor.
   * @param {(payload: { message: string, type: string }) => void} callback
   */
  onLog: (callback) => {
    ipcRenderer.on('log-message', (_event, payload) => callback(payload));
  },

  /** Fires when the entire batch completes successfully. */
  onProcessingComplete: (callback) => {
    ipcRenderer.on('processing-complete', (_event) => callback());
  },

  /** Fires when processing terminates due to an unrecoverable error. */
  onProcessingError: (callback) => {
    ipcRenderer.on('processing-error', (_event, message) => callback(message));
  },

  // ── Cleanup (call before re-registering listeners) ─────────────────────
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('log-message');
    ipcRenderer.removeAllListeners('processing-complete');
    ipcRenderer.removeAllListeners('processing-error');
  }
});
