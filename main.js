'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { processFolder } = require('./services/imageProcessor');

let mainWindow = null;

// Cancellation token shared between IPC handlers
const cancellationToken = { cancelled: false };

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:     920,
    height:    780,
    minWidth:  680,
    minHeight: 560,
    title:     'VIVE AI',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false   // needed for sharp native module via preload path
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    cancellationToken.cancelled = true;
    mainWindow = null;
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC handlers ─────────────────────────────────────────────────────────────

/** Opens a native directory picker and returns the chosen path. */
ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    title:       'Select folder containing images',
    properties:  ['openDirectory'],
    buttonLabel: 'Select Folder'
  });

  return result.canceled ? null : result.filePaths[0];
});

/** Starts batch processing. Streams log events back to the renderer. */
ipcMain.handle('start-processing', async (_event, { folderPath, quality, apiKey }) => {
  if (!mainWindow) return { success: false, error: 'Window not available' };

  cancellationToken.cancelled = false;

  const sendLog = (message, type = 'info') => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log-message', { message, type });
    }
  };

  try {
    await processFolder(folderPath, quality, apiKey, sendLog, cancellationToken);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('processing-complete');
    }
    return { success: true };

  } catch (err) {
    const msg = err?.message ?? String(err);
    sendLog('Fatal error: ' + msg, 'error');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('processing-error', msg);
    }
    return { success: false, error: msg };
  }
});

/** Sets the cancellation flag so the processor exits after the current image. */
ipcMain.handle('cancel-processing', () => {
  cancellationToken.cancelled = true;
});
