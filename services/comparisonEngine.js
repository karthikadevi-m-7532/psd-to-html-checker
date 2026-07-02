/**
 * Comparison engine: takes PSD data + HTML data and produces a mismatch report.
 */

// ─── Color Utilities ────────────────────────────────────────────────
function parseRgbString(str) {
  if (!str) return null;
  // "rgb(r, g, b)" or "rgba(r, g, b, a)"
  const match = str.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
  }
  return null;
}

function hexToRgb(hex) {
  if (!hex) return null;
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function colorDistance(c1, c2) {
  if (!c1 || !c2) return Infinity;
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) +
    Math.pow(c1.g - c2.g, 2) +
    Math.pow(c1.b - c2.b, 2)
  );
}

// ─── Parsing CSS Values ─────────────────────────────────────────────
function parsePx(value) {
  if (!value) return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 0 : Math.round(num * 100) / 100;
}

function normalizeFontFamily(ff) {
  if (!ff) return [];
  return ff
    .split(',')
    .map((f) => f.trim().replace(/["']/g, '').toLowerCase())
    .filter(Boolean);
}

/**
 * Extract the core font name AND the weight/style suffix separately.
 * e.g. "ZohoPuvi-Regular"     → { core: "zohopuvi", weight: "regular" }
 *      "Zoho_Puvi_Semibold"   → { core: "zohopuvi", weight: "semibold" }
 *      "Open Sans Bold"       → { core: "opensans", weight: "bold" }
 *      "Roboto-MediumItalic"  → { core: "roboto",   weight: "mediumitalic" }
 *      "Roboto"               → { core: "roboto",   weight: "" }
 */
const WEIGHT_STYLE_SUFFIXES = [
  'semibold', 'semi-bold', 'demibold', 'demi-bold',
  'extrabold', 'extra-bold', 'ultrabold', 'ultra-bold',
  'extralight', 'extra-light', 'ultralight', 'ultra-light',
  'bolditalic', 'bold-italic',
  'mediumitalic', 'medium-italic',
  'semibolditalic', 'semibold-italic',
  'lightitalic', 'light-italic',
  'bold', 'medium', 'light', 'thin', 'hairline', 'heavy', 'black',
  'regular', 'normal',
  'italic', 'oblique',
  'condensed', 'expanded', 'narrow',
];

function parseFontName(name) {
  if (!name) return { core: '', weight: '' };
  let s = name.toLowerCase().replace(/["']/g, '');

  let extractedWeight = '';
  for (const suffix of WEIGHT_STYLE_SUFFIXES) {
    // Match suffix at the end, possibly preceded by a separator
    const re = new RegExp('[\\s_\\-]?(' + suffix.replace('-', '\\-?') + ')$', 'i');
    const match = s.match(re);
    if (match) {
      extractedWeight = match[1].replace(/[\s_\-]/g, '');
      s = s.replace(re, '');
      break;
    }
  }

  // Strip all separators to get the core name
  const core = s.replace(/[\s_\-]/g, '');
  return { core, weight: extractedWeight };
}

/**
 * Infer font weight from a font-family string (e.g. "ZohoPuvi-Semibold" → "600").
 * Checks for weight keywords in the font name. Works for both PSD and HTML font names.
 * Returns null if no weight keyword found.
 */
function inferWeightFromFontName(fontFamily) {
  if (!fontFamily) return null;
  // For comma-separated font lists (HTML), check each one
  const fonts = fontFamily.split(',').map((f) => f.trim().replace(/["']/g, ''));
  for (const font of fonts) {
    const parsed = parseFontName(font);
    if (parsed.weight) {
      return weightSuffixToNumeric(parsed.weight) || parsed.weight;
    }
  }
  return null;
}

/**
 * Normalize a weight string extracted from a font name to a CSS-like numeric value.
 */
function weightSuffixToNumeric(w) {
  if (!w) return '';
  const map = {
    thin: '100', hairline: '100',
    extralight: '200', ultralight: '200',
    light: '300',
    regular: '400', normal: '400',
    medium: '500',
    semibold: '600', demibold: '600',
    bold: '700',
    extrabold: '800', ultrabold: '800',
    black: '900', heavy: '900',
  };
  // Strip italic/oblique to get the pure weight part
  const pure = w.replace(/italic|oblique/g, '').trim();
  return map[pure] || '';
}

/**
 * Check if two font family names refer to the same font (including weight variant).
 * 
 * "ZohoPuvi-Semibold" vs "Zoho_Puvi_Regular" → NOT a match (different weight variant = different font-family)
 * "ZohoPuvi-Regular" vs "Zoho_Puvi_Regular"  → match
 * "ZohoPuvi-Regular" vs "Zoho_Puvi"          → match (one has no weight suffix)
 * "OpenSans-Bold" vs "Open Sans"             → match (one has no weight suffix)
 * "Arial" vs "Helvetica"                     → NOT a match (different core name)
 */
function fontFamiliesMatch(psdFonts, htmlFonts) {
  for (const pf of psdFonts) {
    const psdParsed = parseFontName(pf);
    for (const hf of htmlFonts) {
      const htmlParsed = parseFontName(hf);

      let coreMatch = false;
      // Exact core match: "zohopuvi" === "zohopuvi"
      if (psdParsed.core === htmlParsed.core) {
        coreMatch = true;
      }
      // One contains the other (for partial names)
      if (!coreMatch && psdParsed.core.length > 2 && htmlParsed.core.length > 2) {
        if (psdParsed.core.includes(htmlParsed.core) || htmlParsed.core.includes(psdParsed.core)) {
          coreMatch = true;
        }
      }

      if (coreMatch) {
        // If BOTH names have a weight suffix, they must match.
        // e.g. "Semibold" vs "Regular" → mismatch (different font-family variant)
        // If only one (or neither) has a suffix, treat as a match.
        const bothHaveWeight = psdParsed.weight && htmlParsed.weight;
        if (bothHaveWeight) {
          const psdW = weightSuffixToNumeric(psdParsed.weight) || psdParsed.weight;
          const htmlW = weightSuffixToNumeric(htmlParsed.weight) || htmlParsed.weight;
          if (psdW !== htmlW) {
            // Same core font but different weight variant → NOT a family match
            continue;
          }
        }
        return true;
      }
    }
  }
  return false;
}

function normalizeFontWeight(fw) {
  if (!fw) return '400';
  const map = {
    thin: '100', hairline: '100',
    extralight: '200', ultralight: '200',
    light: '300',
    normal: '400', regular: '400',
    medium: '500',
    semibold: '600', demibold: '600',
    bold: '700',
    extrabold: '800', ultrabold: '800',
    black: '900', heavy: '900',
  };
  const str = String(fw).toLowerCase().replace(/[\s-]/g, '');
  return map[str] || String(fw);
}

// ─── Thresholds ─────────────────────────────────────────────────────
const THRESHOLDS = {
  spacing: 3,           // px tolerance for margins/padding
  maxSpacingDiff: 150,  // max px diff — anything larger is likely a bad match, skip it
  fontSize: 1,          // px tolerance for font sizes
  lineHeight: 2,        // px tolerance for line heights
  letterSpacing: 0.5,   // em tolerance for letter spacing
  colorDistance: 15,     // RGB Euclidean distance tolerance
  positionTolerance: 5,  // px tolerance for element positions
  sizeTolerance: 5,      // px tolerance for element dimensions
};

// ─── Priority Calculator ────────────────────────────────────────────
function getPriority(category, diff) {
  if (category === 'color') {
    if (diff > 50) return 'critical';
    if (diff > 30) return 'high';
    if (diff > 15) return 'medium';
    return 'low';
  }
  if (category === 'fontSize') {
    if (diff > 4) return 'critical';
    if (diff > 2) return 'high';
    if (diff > 1) return 'medium';
    return 'low';
  }
  if (category === 'spacing') {
    if (diff > 15) return 'critical';
    if (diff > 8) return 'high';
    if (diff > 3) return 'medium';
    return 'low';
  }
  if (category === 'fontFamily') return 'high';
  if (category === 'fontWeight') return 'medium';
  return 'low';
}

// ─── Main Comparison ────────────────────────────────────────────────

function compareDesigns(psdData, htmlData) {
  const issues = [];
  const matches = [];

  const psdTextLayers = psdData.layers.filter((l) => l.type === 'text');
  const htmlTextElements = htmlData.elements.filter((e) => e.elementType === 'text' && e.text && e.insideMain);
  const htmlContainers = htmlData.elements.filter((e) => e.elementType === 'container' && e.insideMain);

  // 1. Match PSD text layers to HTML text elements based on text content similarity
  const matchedPairs = matchTextLayers(psdTextLayers, htmlTextElements);

  for (const { psdLayer, htmlElement, matchScore } of matchedPairs) {
    const psdStyle = psdLayer.fontStyles && psdLayer.fontStyles[0] ? psdLayer.fontStyles[0] : {};
    const htmlStyle = htmlElement.styles;

    // ── Font Family + Weight Combined Comparison ──
    // Only compare when both sides have font family data
    if (psdStyle.fontFamily && htmlStyle.fontFamily) {
      // Font family check
      const psdFonts = normalizeFontFamily(psdStyle.fontFamily);
      const htmlFonts = normalizeFontFamily(htmlStyle.fontFamily);
      const familyMatched = fontFamiliesMatch(psdFonts, htmlFonts);

      // Font weight check — infer from font name if not explicitly set
      const psdWeightFromName = inferWeightFromFontName(psdStyle.fontFamily);
      const htmlWeightFromName = inferWeightFromFontName(htmlStyle.fontFamily);
      const psdWeightRaw = psdStyle.fontWeight || psdWeightFromName || '400';
      const htmlWeightRaw = htmlStyle.fontWeight || htmlWeightFromName || '400';
      const psdWeight = normalizeFontWeight(psdWeightRaw);
      const htmlWeight = normalizeFontWeight(htmlWeightRaw);
      const weightMatched = psdWeight === htmlWeight;

      if (familyMatched && weightMatched) {
        matches.push({
          type: 'font',
          element: buildSelector(htmlElement),
          psdValue: `${psdStyle.fontFamily} (${psdWeight})`,
          htmlValue: `${htmlStyle.fontFamily} (${htmlWeight})`,
        });
      } else {
        const parts = [];
        if (!familyMatched) {
          parts.push(`family: PSD "${psdStyle.fontFamily}" vs HTML "${htmlStyle.fontFamily}"`);
        }
        if (!weightMatched) {
          parts.push(`weight: PSD ${psdWeight} vs HTML ${htmlWeight}`);
        }

        issues.push({
          type: 'font',
          category: 'fonts',
          priority: !familyMatched ? 'high' : 'medium',
          element: buildSelector(htmlElement),
          psdLayer: psdLayer.name,
          htmlSelector: buildSelector(htmlElement),
          htmlBounds: htmlElement.bounds,
          psdValue: `${psdStyle.fontFamily} (${psdWeight})`,
          htmlValue: `${htmlStyle.fontFamily} (${htmlWeight})`,
          message: `Font mismatch: ${parts.join('; ')}`,
        });
      }
    }

    // ── Font Size Comparison ──
    if (psdStyle.fontSize && htmlStyle.fontSize) {
      const htmlFontSize = parsePx(htmlStyle.fontSize);
      const diff = Math.abs(psdStyle.fontSize - htmlFontSize);

      if (diff <= THRESHOLDS.fontSize) {
        matches.push({
          type: 'fontSize',
          element: buildSelector(htmlElement),
          psdValue: `${psdStyle.fontSize}px`,
          htmlValue: htmlStyle.fontSize,
        });
      } else {
        issues.push({
          type: 'fontSize',
          category: 'fonts',
          priority: getPriority('fontSize', diff),
          element: buildSelector(htmlElement),
          psdLayer: psdLayer.name,
          htmlSelector: buildSelector(htmlElement),
          htmlBounds: htmlElement.bounds,
          psdValue: `${psdStyle.fontSize}px`,
          htmlValue: htmlStyle.fontSize,
          difference: `${diff}px`,
          message: `Font size mismatch: PSD is ${psdStyle.fontSize}px but HTML is ${htmlStyle.fontSize} (diff: ${diff.toFixed(1)}px)`,
        });
      }
    }

    // ── Text Color Comparison ──
    if (psdStyle.color) {
      const psdColor = hexToRgb(psdStyle.color);
      const htmlColor = parseRgbString(htmlStyle.color);

      if (psdColor && htmlColor) {
        const dist = colorDistance(psdColor, htmlColor);
        const htmlHex = rgbToHex(htmlColor.r, htmlColor.g, htmlColor.b);

        if (dist <= THRESHOLDS.colorDistance) {
          matches.push({
            type: 'color',
            element: buildSelector(htmlElement),
            psdValue: psdStyle.color,
            htmlValue: htmlHex,
          });
        } else {
          issues.push({
            type: 'color',
            category: 'colors',
            priority: getPriority('color', dist),
            element: buildSelector(htmlElement),
            psdLayer: psdLayer.name,
            htmlSelector: buildSelector(htmlElement),
            htmlBounds: htmlElement.bounds,
            psdValue: psdStyle.color,
            htmlValue: htmlHex,
            difference: `Distance: ${dist.toFixed(1)}`,
            message: `Text color mismatch: PSD is ${psdStyle.color} but HTML is ${htmlHex}`,
          });
        }
      }
    }

    // ── Line Height Comparison ──
    if (psdStyle.lineHeight && htmlStyle.lineHeight) {
      const htmlLineHeight = parsePx(htmlStyle.lineHeight);
      if (htmlLineHeight > 0) {
        const diff = Math.abs(psdStyle.lineHeight - htmlLineHeight);
        if (diff <= THRESHOLDS.lineHeight) {
          matches.push({
            type: 'lineHeight',
            element: buildSelector(htmlElement),
            psdValue: `${psdStyle.lineHeight}px`,
            htmlValue: htmlStyle.lineHeight,
          });
        } else {
          issues.push({
            type: 'lineHeight',
            category: 'line-height',
            priority: getPriority('spacing', diff),
            element: buildSelector(htmlElement),
            psdLayer: psdLayer.name,
            htmlSelector: buildSelector(htmlElement),
            htmlBounds: htmlElement.bounds,
            psdValue: `${psdStyle.lineHeight}px`,
            htmlValue: htmlStyle.lineHeight,
            difference: `${diff.toFixed(1)}px`,
            message: `Line height mismatch: PSD is ${psdStyle.lineHeight}px but HTML is ${htmlStyle.lineHeight} (diff: ${diff.toFixed(1)}px)`,
          });
        }
      }
    }

    // ── Letter Spacing Comparison ──
    if (psdStyle.letterSpacing !== undefined && htmlStyle.letterSpacing && htmlStyle.letterSpacing !== 'normal') {
      const htmlLS = parsePx(htmlStyle.letterSpacing);
      const psdLSinPx = psdStyle.letterSpacing * (psdStyle.fontSize || 16);
      const diff = Math.abs(psdLSinPx - htmlLS);

      if (diff > THRESHOLDS.letterSpacing) {
        issues.push({
          type: 'letterSpacing',
          category: 'letter-spacing',
          priority: getPriority('spacing', diff),
          element: buildSelector(htmlElement),
          psdLayer: psdLayer.name,
          htmlSelector: buildSelector(htmlElement),
          htmlBounds: htmlElement.bounds,
          psdValue: `${psdStyle.letterSpacing}em (~${psdLSinPx.toFixed(1)}px)`,
          htmlValue: htmlStyle.letterSpacing,
          difference: `${diff.toFixed(1)}px`,
          message: `Letter spacing mismatch: PSD is ${psdStyle.letterSpacing}em but HTML is ${htmlStyle.letterSpacing}`,
        });
      }
    }

    // ── Text Alignment Comparison ──
    if (psdStyle.textAlign && htmlStyle.textAlign) {
      const psdAlign = normalizeTextAlign(psdStyle.textAlign);
      const htmlAlign = normalizeTextAlign(htmlStyle.textAlign);

      if (psdAlign !== htmlAlign && psdAlign !== 'left') {
        const psdAlignCSS = `text-align: ${psdAlign}`;
        const htmlAlignCSS = describeHtmlAlignment(htmlStyle);

        issues.push({
          type: 'textAlign',
          category: 'text-align',
          priority: 'medium',
          element: buildSelector(htmlElement),
          psdLayer: psdLayer.name,
          htmlSelector: buildSelector(htmlElement),
          htmlBounds: htmlElement.bounds,
          psdValue: psdAlignCSS,
          htmlValue: htmlAlignCSS,
          message: `Text alignment mismatch: PSD uses ${psdAlignCSS} but HTML uses ${htmlAlignCSS}`,
        });
      }
    }
  }

  // 2. Compare spacing between consecutive PSD layers vs HTML elements
  const spacingIssues = compareSpacing(psdData, htmlData);
  issues.push(...spacingIssues);

  // 3. Compare container/section background colors
  const bgIssues = compareBackgroundColors(psdData, htmlData);
  issues.push(...bgIssues);

  // Sort issues by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

  // Summary
  const summary = {
    totalIssues: issues.length,
    totalMatches: matches.length,
    critical: issues.filter((i) => i.priority === 'critical').length,
    high: issues.filter((i) => i.priority === 'high').length,
    medium: issues.filter((i) => i.priority === 'medium').length,
    low: issues.filter((i) => i.priority === 'low').length,
    fontIssues: issues.filter((i) => i.category === 'fonts').length,
    colorIssues: issues.filter((i) => i.category === 'colors').length,
    textAlignIssues: issues.filter((i) => i.category === 'text-align').length,
    spacingIssues: issues.filter((i) => i.category === 'spacing').length,
    matchedTextLayers: matchedPairs.length,
    unmatchedPsdLayers: psdTextLayers.length - matchedPairs.length,
  };

  // Overall score (0-100)
  const total = issues.length + matches.length;
  summary.score = total > 0 ? Math.round((matches.length / total) * 100) : 100;

  return {
    summary,
    issues,
    matches,
    psdInfo: {
      width: psdData.width,
      height: psdData.height,
      totalLayers: psdData.layers.length,
      textLayers: psdTextLayers.length,
    },
    htmlInfo: {
      url: htmlData.url,
      totalElements: htmlData.elements.length,
      textElements: htmlTextElements.length,
      viewport: htmlData.viewport,
      viewportWidth: htmlData.viewport ? htmlData.viewport.width : 1440,
      pageHeight: htmlData.pageInfo ? htmlData.pageInfo.pageHeight : null,
      pageWidth: htmlData.pageInfo ? htmlData.pageInfo.pageWidth : null,
    },
  };
}

// ─── Text Matching Logic ────────────────────────────────────────────

function matchTextLayers(psdLayers, htmlElements) {
  const pairs = [];
  const usedHtml = new Set();

  for (const psdLayer of psdLayers) {
    const psdText = (psdLayer.text || psdLayer.fontStyles?.[0]?.text || '').trim().toLowerCase();
    if (!psdText) continue;

    let bestMatch = null;
    let bestScore = 0;

    for (let i = 0; i < htmlElements.length; i++) {
      if (usedHtml.has(i)) continue;

      const htmlText = (htmlElements[i].text || '').trim().toLowerCase();
      if (!htmlText) continue;

      const score = textSimilarity(psdText, htmlText);
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = i;
      }
    }

    if (bestMatch !== null) {
      usedHtml.add(bestMatch);
      pairs.push({
        psdLayer,
        htmlElement: htmlElements[bestMatch],
        matchScore: bestScore,
      });
    }
  }

  return pairs;
}

function textSimilarity(a, b) {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;

  // Simple word overlap
  const wordsA = a.split(/\s+/);
  const wordsB = new Set(b.split(/\s+/));
  const overlap = wordsA.filter((w) => wordsB.has(w)).length;
  return overlap / Math.max(wordsA.length, wordsB.size);
}

// ─── Spacing Comparison ─────────────────────────────────────────────

/**
 * Compare vertical spacing between elements in PSD vs HTML.
 *
 * Strategy — "Row-based element-to-element gaps":
 *  1. In both PSD and HTML, identify the major VISUAL ROWS:
 *     elements that are vertically stacked (header, paragraph, button-row, image-area, etc.)
 *  2. Merge elements on the same horizontal line into a single "row" (e.g. four buttons = one row).
 *  3. Compare:
 *     a. Section top → first row  (top padding)
 *     b. Row-to-row gaps          (vertical spacing between elements)
 *     c. Last row → section bottom (bottom padding)
 *  4. Match PSD rows to HTML rows using text content similarity.
 */
function compareSpacing(psdData, htmlData) {
  const issues = [];
  const scaleRatio = htmlData.viewport ? htmlData.viewport.width / psdData.width : 1;

  // ── Step 1: Build PSD visual rows ──
  // Get all visible, non-group PSD layers.
  // EXCLUDE: oversized background/container layers (covering >60% of doc height or width)
  // These are decorative backgrounds, not spacing-relevant content elements.
  const maxLayerHeight = psdData.height * 0.6;
  const maxLayerWidth = psdData.width * 0.95;
  const psdVisibleLayers = psdData.layers.filter(
    (l) => l.type !== 'group' &&
    l.bounds.height > 0 && l.bounds.width > 0 &&
    l.bounds.height < maxLayerHeight &&
    !(l.type === 'layer' && l.bounds.width >= maxLayerWidth && l.bounds.height > psdData.height * 0.05)
  );

  // Group PSD layers that belong to the same group parent
  const psdGroups = psdData.layers
    .filter((l) => l.type === 'group' && l.bounds.height > 50 && l.bounds.width > psdData.width * 0.3)
    .sort((a, b) => a.bounds.top - b.bounds.top);

  // Build PSD sections from the largest meaningful groups
  const psdSections = buildPsdSections(psdGroups, psdVisibleLayers, psdData);

  // ── Step 2: Build HTML visual rows ──
  const htmlSections = buildHtmlSections(htmlData);

  // ── Step 3: Match PSD sections ↔ HTML sections and compare ──
  // Use a combined scoring: text similarity + vertical overlap
  const usedHtml = new Set();

  for (const psdSec of psdSections) {
    const scaledPsdTop = Math.round(psdSec.bounds.top * scaleRatio);
    const scaledPsdBottom = Math.round(psdSec.bounds.bottom * scaleRatio);

    // Collect all text from PSD section children
    const psdTexts = psdSec.children
      .map((c) => (c.text || c.name || '').trim().toLowerCase())
      .filter(Boolean);

    let bestIdx = null;
    let bestScore = -Infinity;

    for (let i = 0; i < htmlSections.length; i++) {
      if (usedHtml.has(i)) continue;
      const hs = htmlSections[i];

      // Text-based score: how many PSD texts match HTML texts
      const htmlTexts = hs.children
        .map((c) => (c.text || '').trim().toLowerCase())
        .filter(Boolean);

      let textScore = 0;
      for (const pt of psdTexts) {
        for (const ht of htmlTexts) {
          const sim = textSimilarity(pt, ht);
          if (sim > 0.3) textScore += sim;
        }
      }

      // Overlap-based score
      const overlapTop = Math.max(scaledPsdTop, hs.top);
      const overlapBot = Math.min(scaledPsdBottom, hs.bottom);
      const overlap = Math.max(0, overlapBot - overlapTop);
      const maxRange = Math.max(scaledPsdBottom - scaledPsdTop, hs.bottom - hs.top, 1);
      const overlapScore = overlap / maxRange;

      // Combined score: text match is worth more than overlap
      const combinedScore = textScore * 3 + overlapScore;

      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestIdx = i;
      }
    }

    // Only match if we have some score (avoid garbage matches)
    if (bestIdx === null || bestScore <= 0) continue;
    usedHtml.add(bestIdx);

    const htmlSec = htmlSections[bestIdx];
    const secName = psdSec.name;
    const htmlSecLabel = htmlSec.label;

    // Build PSD rows from this section's children (merge same-line elements)
    const psdRows = mergeIntoRows(psdSec.children, 15);
    const htmlRows = mergeIntoRows(htmlSec.children, 10);

    // ── Step 4: Match rows by text similarity ──
    const rowPairs = matchRows(psdRows, htmlRows);

    // ── Step 5a: Section top padding → first row ──
    if (psdRows.length > 0 && htmlRows.length > 0) {
      const psdTopPad = psdRows[0].top - psdSec.bounds.top;
      const scaledPsdTopPad = Math.round(psdTopPad * scaleRatio);
      const htmlTopPad = htmlRows[0].top - htmlSec.top;

      if (scaledPsdTopPad > 0 && htmlTopPad > 0) {
        const diff = Math.abs(scaledPsdTopPad - htmlTopPad);
        if (diff > THRESHOLDS.spacing * 2 && diff <= THRESHOLDS.maxSpacingDiff) {
          const firstLabel = getRowLabel(psdRows[0]);
          const firstHtmlSelector = getRowSelectorLabel(htmlRows[0]);
          const htmlSecSel = htmlSec.selector || htmlSecLabel;
          const topLeft = htmlRows[0].left || 0;
          const topRight = htmlRows[0].right || 1440;
          issues.push({
            type: 'topPadding',
            category: 'spacing',
            priority: getPriority('spacing', diff),
            element: `${htmlSecSel} → ${firstHtmlSelector}`,
            psdLayer: secName,
            htmlSelector: `${htmlSecSel} → ${firstHtmlSelector}`,
            htmlBounds: { top: htmlSec.top, left: topLeft, bottom: htmlRows[0].bottom, right: topRight, width: topRight - topLeft, height: htmlRows[0].bottom - htmlSec.top },
            htmlGapBounds: { top: htmlSec.top, left: topLeft, bottom: htmlRows[0].top, right: topRight, width: topRight - topLeft, height: htmlRows[0].top - htmlSec.top },
            psdValue: `${scaledPsdTopPad}px`,
            htmlValue: `${htmlTopPad}px`,
            difference: `${diff}px`,
            message: `Section top → first row: PSD ${scaledPsdTopPad}px vs HTML ${htmlTopPad}px (diff: ${diff}px)`,
          });
        }
      }
    }

    // ── Step 5b: Row-to-row gaps ──
    for (let i = 0; i < rowPairs.length - 1; i++) {
      const pairA = rowPairs[i];
      const pairB = rowPairs[i + 1];
      if (!pairA || !pairB) continue;
      if (!pairA.psd || !pairA.html || !pairB.psd || !pairB.html) continue;

      const psdGap = pairB.psd.top - pairA.psd.bottom;
      const scaledPsdGap = Math.round(psdGap * scaleRatio);
      const htmlGap = pairB.html.top - pairA.html.bottom;

      // Skip if either side is 0 or negative
      if (scaledPsdGap <= 0 || htmlGap <= 0) continue;

      const diff = Math.abs(scaledPsdGap - htmlGap);
      if (diff > THRESHOLDS.spacing * 2 && diff <= THRESHOLDS.maxSpacingDiff) {
        const labelA = getRowLabel(pairA.psd);
        const labelB = getRowLabel(pairB.psd);
        const htmlSelA = getRowSelectorLabel(pairA.html);
        const htmlSelB = getRowSelectorLabel(pairB.html);

        const gapLeft = Math.min(pairA.html.left, pairB.html.left);
        const gapRight = Math.max(pairA.html.right, pairB.html.right);

        issues.push({
          type: 'verticalGap',
          category: 'spacing',
          priority: getPriority('spacing', diff),
          element: `${htmlSelA} → ${htmlSelB}`,
          psdLayer: `${secName}: ${labelA} → ${labelB}`,
          htmlSelector: `${htmlSelA} → ${htmlSelB}`,
          htmlBounds: { top: pairA.html.top, left: gapLeft, bottom: pairB.html.bottom, right: gapRight, width: gapRight - gapLeft, height: pairB.html.bottom - pairA.html.top },
          htmlGapBounds: { top: pairA.html.bottom, left: gapLeft, bottom: pairB.html.top, right: gapRight, width: gapRight - gapLeft, height: pairB.html.top - pairA.html.bottom },
          psdValue: `${scaledPsdGap}px`,
          htmlValue: `${htmlGap}px`,
          difference: `${diff}px`,
          message: `Row gap: PSD ${scaledPsdGap}px vs HTML ${htmlGap}px (diff: ${diff}px)`,
        });
      }
    }

    // ── Step 5c: Last row → section bottom ──
    if (psdRows.length > 0 && htmlRows.length > 0) {
      const psdBotPad = psdSec.bounds.bottom - psdRows[psdRows.length - 1].bottom;
      const scaledPsdBotPad = Math.round(psdBotPad * scaleRatio);
      const htmlBotPad = htmlSec.bottom - htmlRows[htmlRows.length - 1].bottom;

      if (scaledPsdBotPad > 0 && htmlBotPad > 0) {
        const diff = Math.abs(scaledPsdBotPad - htmlBotPad);
        if (diff > THRESHOLDS.spacing * 2 && diff <= THRESHOLDS.maxSpacingDiff) {
          const lastLabel = getRowLabel(psdRows[psdRows.length - 1]);
          const lastHtmlSelector = getRowSelectorLabel(htmlRows[htmlRows.length - 1]);
          const htmlSecSel = htmlSec.selector || htmlSecLabel;
          const lastRow = htmlRows[htmlRows.length - 1];
          const botLeft = lastRow.left || 0;
          const botRight = lastRow.right || 1440;
          issues.push({
            type: 'bottomPadding',
            category: 'spacing',
            priority: getPriority('spacing', diff),
            element: `${lastHtmlSelector} → ${htmlSecSel}`,
            psdLayer: secName,
            htmlSelector: `${lastHtmlSelector} → ${htmlSecSel}`,
            htmlBounds: { top: lastRow.top, left: botLeft, bottom: htmlSec.bottom, right: botRight, width: botRight - botLeft, height: htmlSec.bottom - lastRow.top },
            htmlGapBounds: { top: lastRow.bottom, left: botLeft, bottom: htmlSec.bottom, right: botRight, width: botRight - botLeft, height: htmlSec.bottom - lastRow.bottom },
            psdValue: `${scaledPsdBotPad}px`,
            htmlValue: `${htmlBotPad}px`,
            difference: `${diff}px`,
            message: `Last row → section bottom: PSD ${scaledPsdBotPad}px vs HTML ${htmlBotPad}px (diff: ${diff}px)`,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Build PSD sections: each is a major group with its visible children.
 */
function buildPsdSections(groups, visibleLayers, psdData) {
  const sections = [];
  const assigned = new Set();

  // Sort groups by area (smallest first) so children go to most specific group
  const sorted = [...groups].sort((a, b) =>
    (a.bounds.width * a.bounds.height) - (b.bounds.width * b.bounds.height)
  );

  for (const group of sorted) {
    const gb = group.bounds;
    const children = visibleLayers.filter((child) =>
      !assigned.has(child) &&
      child.bounds.top >= gb.top - 10 &&
      child.bounds.bottom <= gb.bottom + 10 &&
      child.bounds.left >= gb.left - 10 &&
      child.bounds.right <= gb.right + 10 &&
      // Exclude children that are section-sized backgrounds (cover >80% of section height)
      child.bounds.height < gb.height * 0.8
    ).sort((a, b) => a.bounds.top - b.bounds.top);

    if (children.length >= 2) {
      children.forEach((c) => assigned.add(c));
      sections.push({ name: group.name, bounds: gb, children });
    }
  }

  // Fallback: whole PSD as one section
  if (sections.length === 0 && visibleLayers.length >= 2) {
    sections.push({
      name: 'Full Page',
      bounds: { top: 0, left: 0, bottom: psdData.height, right: psdData.width, width: psdData.width, height: psdData.height },
      children: [...visibleLayers].sort((a, b) => a.bounds.top - b.bounds.top),
    });
  }

  return sections.sort((a, b) => a.bounds.top - b.bounds.top);
}

/**
 * Build HTML sections: group elements by their parent section container.
 */
function buildHtmlSections(htmlData) {
  // Include text, media, and small containers (buttons, links, etc.) — main section only
  const elements = htmlData.elements.filter(
    (e) => e.insideMain && e.bounds.height > 5 && e.bounds.width > 20 &&
    (e.elementType === 'text' || e.elementType === 'media' ||
     (e.elementType === 'container' && e.bounds.height < 300))
  );

  const sectionMap = new Map();
  for (const el of elements) {
    const sKey = el.parentSection
      ? `${el.parentSection.tag}#${el.parentSection.id}.${el.parentSection.className}|${el.parentSection.bounds.top}`
      : '__root__';

    if (!sectionMap.has(sKey)) {
      sectionMap.set(sKey, {
        section: el.parentSection || null,
        children: [],
      });
    }
    sectionMap.get(sKey).children.push(el);
  }

  const sections = [];
  for (const [key, val] of sectionMap) {
    val.children.sort((a, b) => a.bounds.top - b.bounds.top);
    val.children = deduplicateNestedElements(val.children);
    if (val.children.length < 2) continue;

    const sec = val.section;
    sections.push({
      label: sec ? buildSectionSelector(sec) : 'root',
      selector: sec ? buildSectionSelector(sec) : 'root',
      top: sec ? sec.bounds.top : val.children[0].bounds.top,
      bottom: sec ? sec.bounds.bottom : val.children[val.children.length - 1].bounds.bottom,
      children: val.children,
    });
  }

  return sections.sort((a, b) => a.top - b.top);
}

/**
 * Merge elements that sit on the same horizontal line into a single "row".
 * E.g. four buttons side-by-side become one row with combined bounds.
 * @param {Array} elements - sorted by top
 * @param {number} tolerance - vertical overlap tolerance to consider same row
 * @returns {Array<{top, bottom, left, right, elements, label}>}
 */
function mergeIntoRows(elements, tolerance) {
  if (!elements.length) return [];
  const rows = [];
  let currentRow = [elements[0]];

  for (let i = 1; i < elements.length; i++) {
    const el = elements[i];
    const rowTop = Math.min(...currentRow.map((e) => e.bounds.top));
    const rowBottom = Math.max(...currentRow.map((e) => e.bounds.bottom));
    const rowMid = (rowTop + rowBottom) / 2;
    const elMid = (el.bounds.top + el.bounds.bottom) / 2;

    // If this element's vertical center is within the current row's range, merge it
    if (Math.abs(elMid - rowMid) < (rowBottom - rowTop) / 2 + tolerance) {
      currentRow.push(el);
    } else {
      rows.push(finalizeRow(currentRow));
      currentRow = [el];
    }
  }
  rows.push(finalizeRow(currentRow));

  return rows;
}

function finalizeRow(elements) {
  const top = Math.min(...elements.map((e) => e.bounds.top));
  const bottom = Math.max(...elements.map((e) => e.bounds.bottom));
  const left = Math.min(...elements.map((e) => e.bounds.left));
  const right = Math.max(...elements.map((e) => e.bounds.right));

  // Build a descriptive label from the row's elements (text-based, used for matching)
  const textParts = elements
    .map((e) => (e.text || e.name || '').trim())
    .filter(Boolean);

  let label = '';
  if (textParts.length > 0) {
    const combined = textParts.join(' | ');
    label = combined.length > 60 ? combined.substring(0, 57) + '...' : combined;
  } else {
    // Use element types/tags
    const tags = elements.map((e) => e.tag || e.type || 'element');
    label = [...new Set(tags)].join(', ');
  }

  // Build CSS selector label for HTML rows (when elements have tag/className/id)
  const selectorParts = elements
    .filter((e) => e.tag) // Only HTML elements have tag
    .map((e) => buildSelector(e));

  let selectorLabel = '';
  if (selectorParts.length > 0) {
    const unique = [...new Set(selectorParts)];
    const combined = unique.join(' | ');
    selectorLabel = combined.length > 80 ? combined.substring(0, 77) + '...' : combined;
  }

  return { top, bottom, left, right, elements, label, selectorLabel };
}

/**
 * Get a human-friendly label for a row.
 */
function getRowLabel(row) {
  if (!row) return 'unknown';
  if (row.label) return row.label;
  if (row.elements && row.elements.length > 0) {
    const texts = row.elements.map((e) => (e.text || e.name || '').trim()).filter(Boolean);
    if (texts.length > 0) return texts.join(' | ').substring(0, 60);
  }
  return 'element';
}

/**
 * Get a CSS selector label for an HTML row.
 * Falls back to text label if no selectors available.
 */
function getRowSelectorLabel(row) {
  if (!row) return 'unknown';
  if (row.selectorLabel) return row.selectorLabel;
  // Fallback: build from elements directly
  if (row.elements && row.elements.length > 0) {
    const sels = row.elements
      .filter((e) => e.tag)
      .map((e) => buildSelector(e));
    if (sels.length > 0) {
      const unique = [...new Set(sels)];
      return unique.join(' | ').substring(0, 80);
    }
  }
  return getRowLabel(row);
}

/**
 * Match PSD rows to HTML rows using text content similarity.
 * Returns an array of { psd: row, html: row } pairs in order.
 */
function matchRows(psdRows, htmlRows) {
  const pairs = [];
  const usedHtml = new Set();

  for (const pRow of psdRows) {
    const pTexts = pRow.elements
      .map((e) => (e.text || e.name || '').trim().toLowerCase())
      .filter(Boolean);

    let bestIdx = null;
    let bestScore = 0;

    for (let hi = 0; hi < htmlRows.length; hi++) {
      if (usedHtml.has(hi)) continue;
      const hRow = htmlRows[hi];
      const hTexts = hRow.elements
        .map((e) => (e.text || '').trim().toLowerCase())
        .filter(Boolean);

      // Calculate text similarity between the two rows
      let score = 0;
      for (const pt of pTexts) {
        for (const ht of hTexts) {
          const sim = textSimilarity(pt, ht);
          if (sim > score) score = sim;
        }
      }

      // Also consider positional ordering (prefer sequential matches)
      if (score > bestScore) {
        bestScore = score;
        bestIdx = hi;
      }
    }

    // Accept match if text similarity is decent, or fall back to sequential
    if (bestIdx !== null && bestScore > 0.2) {
      usedHtml.add(bestIdx);
      pairs.push({ psd: pRow, html: htmlRows[bestIdx] });
    } else {
      // Sequential fallback: pick next unused HTML row
      for (let hi = 0; hi < htmlRows.length; hi++) {
        if (!usedHtml.has(hi)) {
          usedHtml.add(hi);
          pairs.push({ psd: pRow, html: htmlRows[hi] });
          break;
        }
      }
    }
  }

  return pairs;
}

/**
 * Remove elements that are fully nested inside another element in the same list.
 * Keeps only the outermost elements to avoid double-counting gaps.
 */
function deduplicateNestedElements(sorted) {
  const result = [];
  for (const el of sorted) {
    if (result.length > 0) {
      const prev = result[result.length - 1];
      if (
        el.bounds.top >= prev.bounds.top &&
        el.bounds.bottom <= prev.bounds.bottom &&
        el.bounds.left >= prev.bounds.left - 5 &&
        el.bounds.right <= prev.bounds.right + 5
      ) {
        continue; // Skip — nested inside previous
      }
    }
    result.push(el);
  }
  return result;
}

function buildSectionSelector(section) {
  let sel = section.tag;
  if (section.id) sel += `#${section.id}`;
  if (section.className) {
    const cls = section.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) sel += `.${cls}`;
  }
  return sel;
}

// ─── Background Color Comparison ────────────────────────────────────

function compareBackgroundColors(psdData, htmlData) {
  const issues = [];
  const psdShapes = psdData.layers.filter((l) => l.type === 'shape' && l.backgroundColor);

  for (const shape of psdShapes) {
    const psdColor = hexToRgb(shape.backgroundColor);
    if (!psdColor) continue;

    // Find HTML containers that overlap this shape's position — main section only
    for (const container of htmlData.elements.filter((e) => e.elementType === 'container' && e.insideMain)) {
      const htmlBg = parseRgbString(container.styles.backgroundColor);
      if (!htmlBg || (htmlBg.r === 0 && htmlBg.g === 0 && htmlBg.b === 0 && container.styles.backgroundColor.includes('0)'))) continue;

      // Check if positions roughly match
      const posMatch =
        Math.abs(shape.bounds.left - container.bounds.left) < THRESHOLDS.positionTolerance * 4 &&
        Math.abs(shape.bounds.top - container.bounds.top) < THRESHOLDS.positionTolerance * 4;

      if (posMatch) {
        const dist = colorDistance(psdColor, htmlBg);
        if (dist > THRESHOLDS.colorDistance) {
          const htmlHex = rgbToHex(htmlBg.r, htmlBg.g, htmlBg.b);
          issues.push({
            type: 'backgroundColor',
            category: 'colors',
            priority: getPriority('color', dist),
            element: buildSelector(container),
            psdLayer: shape.name,
            htmlBounds: container.bounds,
            psdValue: shape.backgroundColor,
            htmlValue: htmlHex,
            difference: `Distance: ${dist.toFixed(1)}`,
            message: `Background color mismatch: PSD "${shape.name}" is ${shape.backgroundColor} but HTML is ${htmlHex}`,
          });
        }
        break;
      }
    }
  }

  return issues;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Describe the HTML element's alignment as developer-friendly CSS.
 * E.g. "text-align: center" or "display: flex; justify-content: center"
 */
function describeHtmlAlignment(styles) {
  const parts = [];
  const display = styles.display || '';
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid' || display === 'inline-grid';

  if (isFlex || isGrid) {
    parts.push(`display: ${display}`);
    if (styles.justifyContent && styles.justifyContent !== 'normal' && styles.justifyContent !== 'flex-start') {
      parts.push(`justify-content: ${styles.justifyContent}`);
    }
    if (styles.alignItems && styles.alignItems !== 'normal' && styles.alignItems !== 'stretch') {
      parts.push(`align-items: ${styles.alignItems}`);
    }
    if (styles.flexDirection && styles.flexDirection !== 'row') {
      parts.push(`flex-direction: ${styles.flexDirection}`);
    }
  }

  const normalizedAlign = normalizeTextAlign(styles.textAlign);
  if (normalizedAlign && normalizedAlign !== 'left') {
    parts.push(`text-align: ${normalizedAlign}`);
  }

  if (parts.length === 0) {
    return `text-align: ${normalizedAlign || 'left'}`;
  }

  return parts.join('; ');
}

/**
 * Normalize text-align values: start→left, end→right
 */
function normalizeTextAlign(value) {
  if (!value) return 'left';
  const map = { start: 'left', end: 'right', '-webkit-auto': 'left' };
  return map[value] || value;
}

function buildSelector(el) {
  let selector = el.tag;
  if (el.id) selector += `#${el.id}`;
  if (el.className) {
    const classes = el.className.split(/\s+/).slice(0, 2).join('.');
    selector += `.${classes}`;
  }
  return selector;
}

module.exports = { compareDesigns };
