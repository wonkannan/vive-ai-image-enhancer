'use strict';

const OpenAI  = require('openai');
const { toFile } = require('openai');
const sharp   = require('sharp');

let client = null;

function initClient(apiKey) {
  client = new OpenAI({ apiKey: apiKey.trim() });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Deep quality analysis using GPT-5.2-Pro Vision
// Returns a structured JSON object used for logging + building the AI prompt.
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeImage(base64Data, mimeType, filename) {
  if (!client) throw new Error('OpenAI client not initialised.');

  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  const systemInstructions = `You are an expert digital image restoration engineer specialising in traditional Indian religious artwork, printed media, and fine art preservation.
Return ONLY a valid JSON object — no markdown, no prose.`;

  const userPrompt = `Analyze this image (${filename}) across all quality dimensions.

Return EXACTLY this JSON:
{
  "analysis": {
    "quality_score":          <integer 1–10>,
    "blur_level":             <"none"|"low"|"medium"|"high">,
    "noise_level":            <"none"|"low"|"medium"|"high">,
    "compression_artifacts":  <"none"|"low"|"medium"|"high">,
    "color_condition":        <"excellent"|"good"|"slightly_faded"|"faded"|"heavily_faded"|"color_shifted">,
    "contrast_condition":     <"balanced"|"flat"|"low"|"over_dark"|"over_bright">,
    "detail_loss":            <"none"|"low"|"medium"|"high">,
    "edge_condition":         <"sharp"|"soft"|"very_soft">,
    "dominant_issues":        [<top 3 issues as strings>],
    "image_type":             <"religious_art"|"portrait"|"landscape"|"document"|"artwork"|"general_photo">
  },
  "enhancement_plan": {
    "recommended_upscale":  <"2x"|"4x"|"8x">,
    "denoise_strength":     <"none"|"light"|"medium"|"strong">,
    "sharpen_strength":     <"none"|"light"|"medium"|"strong"|"very_strong">,
    "color_correction":     <one sentence>,
    "contrast_adjustment":  <one sentence>,
    "special_notes":        <one sentence about preservation requirements>
  },
  "pipeline": [<4–6 processing step descriptions in order>]
}`;

  try {
    // Try Responses API first
    const response = await client.responses.create({
      model: 'gpt-5.4-pro',
      instructions: systemInstructions,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text',  text: userPrompt },
            { type: 'input_image', image_url: dataUrl }
          ]
        }
      ],
      text: { format: { type: 'json_object' } }
    });

    const raw = response.output_text || response.output?.[0]?.content?.[0]?.text;
    if (!raw) throw new Error('Empty response from Responses API');
    return parseAnalysisJSON(raw);

  } catch (e) {
    if (!isFallbackError(e)) throw e;

    // Fallback to Chat Completions
    const fb = await client.chat.completions.create({
      model: 'gpt-5.4-pro',
      messages: [
        { role: 'system', content: systemInstructions },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1000
    });

    const raw = fb.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty response from Chat Completions');
    return parseAnalysisJSON(raw);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Actual image enhancement via OpenAI images.edit
// Tries models in order: gpt-image-1 → gpt-image-1.5 → gpt-image-1-mini
// The AI visually restores the image and returns an enhanced PNG buffer.
// ─────────────────────────────────────────────────────────────────────────────

// Models tried in order (all in your project's allowed list, no verification needed)
const IMAGE_MODELS = ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'];

async function enhanceWithVision(buffer, mimeType, ext, analysisResult) {
  if (!client) throw new Error('OpenAI client not initialised.');

  // Detect orientation → best AI output size
  const meta   = await sharp(buffer).metadata();
  const w      = meta.width  || 1;
  const h      = meta.height || 1;
  const aiSize = h > w ? '1024x1536' : (w > h ? '1536x1024' : '1024x1024');

  const prompt   = buildVisionPrompt(analysisResult);
  const safeExt  = ext.replace('.', '') || 'jpg';
  const safeMime = mimeType || 'image/jpeg';

  let lastError = null;

  for (const model of IMAGE_MODELS) {
    try {
      // Re-create the File each attempt (stream can only be read once)
      const imgFile = await toFile(buffer, `source.${safeExt}`, { type: safeMime });

      const response = await client.images.edit({
        model,
        image:   imgFile,
        prompt,
        size:    aiSize,
        quality: 'high',
        n:       1
      });

      const b64 = response.data[0].b64_json;
      if (!b64) throw new Error(`${model} returned no image data`);

      return { buffer: Buffer.from(b64, 'base64'), modelUsed: model };

    } catch (err) {
      lastError = err;
      // Only fall through to next model for access / permission errors
      const msg = err?.message?.toLowerCase() ?? '';
      const isAccessError = err?.status === 403 || err?.status === 404 ||
                            msg.includes('verified') || msg.includes('permission') ||
                            msg.includes('not found') || msg.includes('not support');
      if (!isAccessError) throw err;   // hard error — don't retry with another model
    }
  }

  throw lastError ?? new Error('All image models failed');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildVisionPrompt(result) {
  const a  = result.analysis;
  const ep = result.enhancement_plan;
  const isReligious = a.image_type === 'religious_art';
  const isArtwork   = isReligious || a.image_type === 'artwork' || a.image_type === 'portrait';

  const lines = [];

  if (isReligious) {
    lines.push(
      'TASK: High-fidelity digital restoration of a traditional Indian religious devotional artwork (calendar art / lithograph / devotional print).',
      ''
    );
  } else {
    lines.push('TASK: Professional photo restoration and image quality enhancement.', '');
  }

  lines.push('QUALITY RESTORATION OBJECTIVES:');

  if (a.blur_level !== 'none') {
    lines.push(`• Restore sharpness and crisp edge definition (blur level: ${a.blur_level})`);
  }
  if (a.noise_level !== 'none' || a.compression_artifacts !== 'none') {
    lines.push(`• Remove noise, grain, and compression artifacts (JPEG blocks, banding, ringing)`);
  }
  if (a.color_condition !== 'excellent') {
    lines.push(`• Color restoration: ${ep.color_correction}`);
  }
  if (a.contrast_condition !== 'balanced') {
    lines.push(`• Contrast/tone: ${ep.contrast_adjustment}`);
  }
  if (a.detail_loss !== 'none') {
    lines.push(`• Recover micro-detail in fine textures, patterns, and surface details`);
  }

  lines.push('• Improve overall clarity and tonal depth');
  lines.push('');

  if (isReligious) {
    lines.push(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'PRESERVATION REQUIREMENTS (ABSOLUTELY CRITICAL):',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '• PRESERVE sacred iconography, divine symbols, weapons (vel/spear), vahana (peacock/vehicle), and all religious objects EXACTLY as they appear',
      '• PRESERVE all facial features, expressions, and eye details of the deity — no alterations whatsoever',
      '• PRESERVE gold jewelry, crown (kireetam), ornaments — restore shine and detail but do not redesign',
      '• PRESERVE garland (malai/haar) and floral offerings — restore color and detail only',
      '• PRESERVE architectural elements (pillars, arches, temple architecture) — restore stone texture and carving detail',
      '• PRESERVE original composition, figure placement, and pose completely',
      '• RESTORE original vibrant colors to their authentic palette — do not shift or reinterpret hues',
      '• RESTORE background (sky, gradient, temple interior) — clean and deepen, do not replace',
      '',
      'This is a RESTORATION task — not a creative reinterpretation. Every visual element must remain true to the original sacred artwork.',
      ''
    );
  } else if (isArtwork) {
    lines.push(
      'PRESERVATION: Maintain original artistic composition and intent. Only restore quality, do not alter content.',
      ''
    );
  }

  if (ep.special_notes) {
    lines.push(`Special note: ${ep.special_notes}`, '');
  }

  if (a.dominant_issues.length > 0) {
    lines.push(`Primary issues to resolve: ${a.dominant_issues.join(', ')}.`);
  }

  lines.push('', 'OUTPUT: The restored version of the exact same image with maximum quality improvements. No content changes.');

  return lines.join('\n');
}

function parseAnalysisJSON(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in analysis response: ' + raw.slice(0, 200));
  const p = JSON.parse(match[0]);
  return {
    analysis: {
      quality_score:         p.analysis?.quality_score         ?? 5,
      blur_level:            p.analysis?.blur_level            ?? 'medium',
      noise_level:           p.analysis?.noise_level           ?? 'low',
      compression_artifacts: p.analysis?.compression_artifacts ?? 'medium',
      color_condition:       p.analysis?.color_condition       ?? 'slightly_faded',
      contrast_condition:    p.analysis?.contrast_condition    ?? 'balanced',
      detail_loss:           p.analysis?.detail_loss           ?? 'medium',
      edge_condition:        p.analysis?.edge_condition        ?? 'soft',
      dominant_issues:       Array.isArray(p.analysis?.dominant_issues) ? p.analysis.dominant_issues : [],
      image_type:            p.analysis?.image_type            ?? 'general_photo'
    },
    enhancement_plan: {
      recommended_upscale: p.enhancement_plan?.recommended_upscale ?? '4x',
      denoise_strength:    p.enhancement_plan?.denoise_strength    ?? 'medium',
      sharpen_strength:    p.enhancement_plan?.sharpen_strength    ?? 'medium',
      color_correction:    p.enhancement_plan?.color_correction    ?? 'Restore natural colors',
      contrast_adjustment: p.enhancement_plan?.contrast_adjustment ?? 'Balance tonal range',
      special_notes:       p.enhancement_plan?.special_notes       ?? ''
    },
    pipeline: Array.isArray(p.pipeline) ? p.pipeline : []
  };
}

function isFallbackError(err) {
  const msg = err?.message?.toLowerCase() ?? '';
  return msg.includes('not found') || msg.includes('unknown') ||
         msg.includes('is not a function') || err?.status === 404;
}

module.exports = { initClient, analyzeImage, enhanceWithVision };
