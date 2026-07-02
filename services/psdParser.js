/**
 * PSD Parser — uses ag-psd to extract layers, fonts, colours, and layout.
 */

const { readPsd } = require('ag-psd');
const fs = require('fs');

// ─── Colour Helpers ──────────────────────────────────────────────────
function toHex255(v) {
  // ag-psd gives colour channels as 0-255 integers
  return Math.round(Math.max(0, Math.min(255, v)));
}

function agColorToHex(c) {
  if (!c) return '';
  // Colour may be { r, g, b } (0-255) or { r, g, b, a } (0-1 each)
  const max = Math.max(c.r || 0, c.g || 0, c.b || 0);
  const [r, g, b] = max <= 1
    ? [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]
    : [toHex255(c.r), toHex255(c.g), toHex255(c.b)];
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

// ─── Layer Extraction ────────────────────────────────────────────────
function extractLayers(children) {
  if (!children) return [];
  const results = [];

  for (const layer of children) {
    const b = layer.bounds || {};
    const left   = b.left   || 0;
    const top    = b.top    || 0;
    const right  = b.right  || 0;
    const bottom = b.bottom || 0;

    const info = {
      name:    layer.name || 'Layer',
      type:    layer.children ? 'group' : (layer.text ? 'text' : 'shape'),
      visible: !layer.hidden,
      bounds: {
        left,
        top,
        right,
        bottom,
        width:  right - left,
        height: bottom - top,
      },
    };

    // ── Text layer ────────────────────────────────────────────────
    if (layer.text) {
      const t  = layer.text;
      const st = t.style || {};

      info.text          = t.text || '';
      info.fontFamily    = st.font?.name || '';
      info.fontSize      = st.fontSize   || 0;
      info.fontWeight    = st.fontWeight || 'normal';
      info.fontStyle     = st.fontStyle  || 'normal';
      info.color         = st.fillColor  ? agColorToHex(st.fillColor) : '';
      info.letterSpacing = st.tracking   || 0;
      info.lineHeight    = st.leading    || 0;
      info.textAlign     = (t.paragraphStyle?.justification || 'left')
        .replace('justifyLeft', 'left')
        .replace('justifyRight', 'right')
        .replace('justifyCenter', 'center')
        .replace('justifyAll', 'justify');
    }

    // ── Shape / fill colour ───────────────────────────────────────
    if (layer.fillEnabled !== false && layer.fill?.color) {
      info.backgroundColor = agColorToHex(layer.fill.color);
    } else if (layer.solidColor) {
      info.backgroundColor = agColorToHex(layer.solidColor);
    }

    results.push(info);

    // Recurse into groups
    if (layer.children) {
      results.push(...extractLayers(layer.children));
    }
  }

  return results;
}

// ─── Public API ──────────────────────────────────────────────────────
function parsePSD(filePath) {
  const buffer = fs.readFileSync(filePath);
  const psd    = readPsd(buffer, { skipThumbnail: true, useRawThumbnail: false });

  const layers = extractLayers(psd.children || []);

  return {
    width:  psd.width  || 0,
    height: psd.height || 0,
    layers,
  };
}

module.exports = { parsePSD };
