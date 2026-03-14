'use strict';

const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');
const { initClient, analyzeImage, enhanceWithVision } = require('./openaiClient');

const SUPPORTED = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp'
};

const QUALITY_SIZES = {
  '4k': { width: 3840, height: 2160, label: '4K  (3840 × 2160)' },
  '8k': { width: 7680, height: 4320, label: '8K  (7680 × 4320)' }
};

// Milliseconds to wait between images (rate-limit safety)
const API_DELAY_MS = 2000;

/*
 * ═══════════════════════════════════════════════════════════════
 *  PIPELINE
 *  ─────────────────────────────────────────────────────────────
 *  1. Local Image Folder   ← read source files
 *  2. AI Enhancement Agent ← orchestrate the full flow
 *  3. Vision Analysis      ← GPT-5.4-Pro   → quality report
 *  4. Image Regeneration   ← chatgpt-image-latest → AI restore
 *  5. Upscale Engine       ← Sharp Lanczos3 → 4K / 8K
 *  6. Enhanced Image       ← save lossless PNG
 * ═══════════════════════════════════════════════════════════════
 */
async function processFolder(folderPath, quality, apiKey, onLog, token) {
  const targetSize = QUALITY_SIZES[quality];
  if (!targetSize) throw new Error(`Unknown quality: ${quality}`);

  initClient(apiKey);

  // ── STAGE 1: Local Image Folder ────────────────────────────────────────
  onLog('', 'info');
  onLog('╔══════════════════════════════════════════════════════╗', 'info');
  onLog('║   AI IMAGE ENHANCEMENT PIPELINE                      ║', 'info');
  onLog('╚══════════════════════════════════════════════════════╝', 'info');
  onLog('', 'info');

  const images = getSupportedImages(folderPath);
  if (images.length === 0) {
    onLog('  [STAGE 1] No supported images found (JPG, JPEG, PNG, WEBP).', 'warn');
    return;
  }

  const outputDir = path.join(folderPath, `output_${quality}`);
  ensureDir(outputDir);

  onLog(`  [STAGE 1] LOCAL IMAGE FOLDER`, 'info');
  onLog(`  │  Path    : ${folderPath}`, 'info');
  onLog(`  │  Images  : ${images.length} file(s) found`, 'info');
  onLog(`  │  Output  : ${outputDir}`, 'info');
  onLog(`  │  Target  : ${targetSize.label}`, 'info');
  onLog('  │', 'info');

  // ── STAGE 2: AI Enhancement Agent (announce) ────────────────────────────
  onLog(`  [STAGE 2] AI ENHANCEMENT AGENT`, 'info');
  onLog(`  │  Analysis model     : GPT-5.4-Pro Vision`, 'info');
  onLog(`  │  Regeneration model : gpt-image-1.5 (fallback: gpt-image-1 → gpt-image-1-mini)`, 'info');
  onLog(`  │  Upscale engine     : Sharp Lanczos3`, 'info');
  onLog('  │', 'info');
  onLog('  ▼', 'info');
  onLog('', 'info');

  let succeeded = 0;
  let failed    = 0;

  for (let i = 0; i < images.length; i++) {
    if (token.cancelled) {
      onLog('  ✖  Processing cancelled.', 'warn');
      break;
    }

    const imgPath  = images[i];
    const filename = path.basename(imgPath);
    const ext      = path.extname(imgPath).toLowerCase();
    const mimeType = SUPPORTED[ext];
    const outName  = path.basename(filename, ext) + '.png';
    const outPath  = path.join(outputDir, outName);

    onLog(`  ┌─────────────────────────────────────────────────────`, 'info');
    onLog(`  │  IMAGE  [${i + 1}/${images.length}]  ${filename}`, 'info');
    onLog(`  ├─────────────────────────────────────────────────────`, 'info');

    try {
      // Read source
      const buffer = fs.readFileSync(imgPath);
      const meta   = await sharp(buffer).metadata();
      onLog(`  │  Source : ${meta.width} × ${meta.height} px  (${(buffer.length / 1024).toFixed(0)} KB)`, 'info');
      onLog('  │', 'info');

      // ── STAGE 3: Vision Analysis ─────────────────────────────────────────
      onLog('  │  ▶ STAGE 3 — VISION ANALYSIS  (GPT-5.4-Pro)', 'info');
      const base64 = buffer.toString('base64');
      const result = await analyzeImage(base64, mimeType, filename);
      const { analysis: a, enhancement_plan: ep } = result;

      onLog(`  │    Score    : ${a.quality_score}/10   Type: ${a.image_type}`, 'info');
      onLog(`  │    Blur     : ${a.blur_level}   Noise: ${a.noise_level}   Artifacts: ${a.compression_artifacts}`, 'info');
      onLog(`  │    Color    : ${a.color_condition}   Contrast: ${a.contrast_condition}   Edges: ${a.edge_condition}`, 'info');
      if (a.dominant_issues.length > 0) {
        onLog(`  │    Issues   : ${a.dominant_issues.join(' · ')}`, 'warn');
      }
      if (ep.special_notes) {
        onLog(`  │    Note     : ${ep.special_notes}`, 'info');
      }
      onLog(`  │    Plan     : denoise=${ep.denoise_strength}  sharpen=${ep.sharpen_strength}  upscale=${ep.recommended_upscale}`, 'info');
      onLog('  │    ✓ Analysis complete', 'success');
      onLog('  │', 'info');

      // ── STAGE 4: Image Regeneration ──────────────────────────────────────
      onLog('  │  ▶ STAGE 4 — FIX IMAGE ISSUES & IMPROVE QUALITY  ★', 'info');
      onLog('  │    Sending image to OpenAI for AI-powered visual restoration…', 'info');

      const { buffer: enhancedBuffer, modelUsed } = await enhanceWithVision(buffer, mimeType, ext, result);

      const enhMeta = await sharp(enhancedBuffer).metadata();
      onLog(`  │    Model used  : ${modelUsed}`, 'info');
      onLog(`  │    AI output   : ${enhMeta.width} × ${enhMeta.height} px`, 'info');
      onLog('  │    ✓ Image regenerated by AI', 'success');
      onLog('  │', 'info');

      // ── STAGE 5: Upscale Engine ───────────────────────────────────────────
      onLog(`  │  ▶ STAGE 5 — UPSCALE ENGINE  (Sharp Lanczos3 → ${targetSize.label})`, 'info');

      await sharp(enhancedBuffer)
        .resize(targetSize.width, targetSize.height, {
          kernel: sharp.kernel.lanczos3,
          fit: 'inside',
          withoutEnlargement: false
        })
        .png({ compressionLevel: 6, adaptiveFiltering: true })
        .toFile(outPath);

      const outStats = fs.statSync(outPath);
      onLog(`  │    Output size : ${(outStats.size / (1024 * 1024)).toFixed(2)} MB`, 'info');
      onLog('  │    ✓ Upscaled to target resolution', 'success');
      onLog('  │', 'info');

      // ── STAGE 6: Enhanced Image saved ─────────────────────────────────────
      onLog(`  │  ▶ STAGE 6 — ENHANCED IMAGE`, 'info');
      onLog(`  │    ✓ Saved → ${outName}`, 'success');
      onLog(`  └─────────────────────────────────────────────────────`, 'info');

      succeeded++;

    } catch (err) {
      onLog(`  │  ✗ ERROR : ${err.message}`, 'error');
      onLog(`  └─────────────────────────────────────────────────────`, 'info');
      failed++;
    }

    onLog('', 'info');

    if (i < images.length - 1 && !token.cancelled) {
      await sleep(API_DELAY_MS);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  onLog('╔══════════════════════════════════════════════════════╗', failed === 0 ? 'success' : 'warn');
  onLog(`║  PIPELINE COMPLETE                                   ║`, failed === 0 ? 'success' : 'warn');
  onLog(`║  Succeeded : ${String(succeeded).padEnd(3)}  Failed : ${String(failed).padEnd(3)}  Total : ${String(images.length).padEnd(3)}        ║`, failed === 0 ? 'success' : 'warn');
  onLog('╚══════════════════════════════════════════════════════╝', failed === 0 ? 'success' : 'warn');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSupportedImages(folderPath) {
  return fs
    .readdirSync(folderPath)
    .filter(f => SUPPORTED[path.extname(f).toLowerCase()])
    .map(f => path.join(folderPath, f))
    .sort();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { processFolder };
