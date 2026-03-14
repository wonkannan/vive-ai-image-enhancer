'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let selectedFolder = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const apiKeyInput     = document.getElementById('api-key');
const toggleKeyBtn    = document.getElementById('toggle-key');
const folderDisplay   = document.getElementById('folder-display');
const selectFolderBtn = document.getElementById('select-folder-btn');
const startBtn        = document.getElementById('start-btn');
const cancelBtn       = document.getElementById('cancel-btn');
const clearLogBtn     = document.getElementById('clear-log-btn');
const logOutput       = document.getElementById('log-output');
const progressFill    = document.getElementById('progress-fill');
const statusText      = document.getElementById('status-text');

// Pipeline node refs (stages 1–6)
const pipeNodes = [1, 2, 3, 4, 5, 6].map(n => document.getElementById(`ps-${n}`));

// ── API key toggle ────────────────────────────────────────────────────────────
toggleKeyBtn.addEventListener('click', () => {
  const show = apiKeyInput.type === 'password';
  apiKeyInput.type         = show ? 'text'     : 'password';
  toggleKeyBtn.textContent = show ? '🙈' : '👁';
});

apiKeyInput.addEventListener('input', () => {
  sessionStorage.setItem('openai-key', apiKeyInput.value);
});
const savedKey = sessionStorage.getItem('openai-key');
if (savedKey) apiKeyInput.value = savedKey;

// ── Folder selection ──────────────────────────────────────────────────────────
selectFolderBtn.addEventListener('click', async () => {
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedFolder            = folder;
    folderDisplay.textContent = folder;
    folderDisplay.title       = folder;
    folderDisplay.classList.add('selected');
    setPipelineStage(1, 'done');          // folder chosen → stage 1 done
  }
});

// ── Start processing ──────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    appendLog('Please enter your OpenAI API key.', 'error');
    apiKeyInput.focus();
    return;
  }
  if (!selectedFolder) {
    appendLog('Please select an image folder first.', 'error');
    return;
  }

  const quality = document.querySelector('input[name="quality"]:checked').value;

  setProcessingState(true);
  clearLog();
  resetPipeline();
  setProgress(0);
  setPipelineStage(1, 'done');
  setPipelineStage(2, 'active');

  window.electronAPI.removeAllListeners();

  window.electronAPI.onLog(({ message, type }) => {
    appendLog(message, type);
    syncPipelineFromLog(message);

    // Progress tracking from "[N/M]" pattern
    const m = message.match(/\[(\d+)\/(\d+)\]/);
    if (m) {
      const pct = (parseInt(m[1]) / parseInt(m[2])) * 100;
      setProgress(pct);
      setStatus(`Image ${m[1]} of ${m[2]}`);
    }
  });

  window.electronAPI.onProcessingComplete(() => {
    setProgress(100);
    setStatus('Complete');
    setProcessingState(false);
    setPipelineStage(6, 'done');
    appendLog('All images have been enhanced and saved.', 'success');
  });

  window.electronAPI.onProcessingError((msg) => {
    setProcessingState(false);
    setStatus('Error');
    appendLog('Processing stopped: ' + msg, 'error');
    markCurrentStageError();
  });

  await window.electronAPI.startProcessing({ folderPath: selectedFolder, quality, apiKey });
});

// ── Cancel ────────────────────────────────────────────────────────────────────
cancelBtn.addEventListener('click', async () => {
  await window.electronAPI.cancelProcessing();
  appendLog('Cancellation requested — finishing current image…', 'warn');
  cancelBtn.disabled = true;
});

// ── Clear log ─────────────────────────────────────────────────────────────────
clearLogBtn.addEventListener('click', clearLog);

// ── Pipeline helpers ──────────────────────────────────────────────────────────

/**
 * Maps log message keywords → pipeline stage transitions.
 * Stage numbers match the architecture:
 *  1 = Local Folder  2 = AI Agent  3 = Vision Analysis
 *  4 = Image Regeneration  5 = Upscale Engine  6 = Enhanced Image
 */
function syncPipelineFromLog(msg) {
  if (msg.includes('STAGE 3') || msg.includes('Vision Analysis') || msg.includes('Analysing')) {
    setPipelineStage(2, 'done');
    setPipelineStage(3, 'active');
  }
  if (msg.includes('Analysis complete')) {
    setPipelineStage(3, 'done');
  }
  if (msg.includes('STAGE 4') || msg.includes('Image Regeneration') || msg.includes('chatgpt-image-latest')) {
    setPipelineStage(3, 'done');
    setPipelineStage(4, 'active');
  }
  if (msg.includes('Image regenerated')) {
    setPipelineStage(4, 'done');
  }
  if (msg.includes('STAGE 5') || msg.includes('Upscale Engine') || msg.includes('Upscaling')) {
    setPipelineStage(4, 'done');
    setPipelineStage(5, 'active');
  }
  if (msg.includes('Upscaled to target')) {
    setPipelineStage(5, 'done');
  }
  if (msg.includes('STAGE 6') || msg.includes('ENHANCED IMAGE') || msg.includes('✓ Saved')) {
    setPipelineStage(5, 'done');
    setPipelineStage(6, 'active');
    setTimeout(() => setPipelineStage(6, 'done'), 600);
  }
  if (msg.includes('PIPELINE COMPLETE')) {
    [1, 2, 3, 4, 5, 6].forEach(n => setPipelineStage(n, 'done'));
  }
}

function setPipelineStage(n, state) {
  const node = pipeNodes[n - 1];
  if (!node) return;
  node.classList.remove('active', 'done', 'error');
  if (state) node.classList.add(state);
}

function resetPipeline() {
  pipeNodes.forEach(n => n.classList.remove('active', 'done', 'error'));
}

function markCurrentStageError() {
  const active = pipeNodes.find(n => n.classList.contains('active'));
  if (active) {
    active.classList.remove('active');
    active.classList.add('error');
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function appendLog(message, type = 'info') {
  if (!message && message !== '') return;
  const line = document.createElement('div');
  line.className = 'log-line ' + type;

  if (message === '') {
    line.innerHTML = '&nbsp;';
  } else {
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
    line.textContent = `[${ts}]  ${message}`;
  }

  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function clearLog() {
  logOutput.innerHTML = '';
}

function setProcessingState(processing) {
  startBtn.disabled        = processing;
  cancelBtn.style.display  = processing ? 'block' : 'none';
  cancelBtn.disabled       = false;
  selectFolderBtn.disabled = processing;
  apiKeyInput.disabled     = processing;
  document.querySelectorAll('input[name="quality"]').forEach(r => { r.disabled = processing; });
  if (!processing) setStatus('Idle');
}

function setProgress(pct) {
  progressFill.style.width = Math.min(100, pct) + '%';
}

function setStatus(text) {
  statusText.textContent = text;
}
