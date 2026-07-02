/**
 * HTML vs HTML Comparison Engine
 * Compares two HTML pages (reference vs live) by matching elements
 * and comparing their computed CSS styles.
 */

// ─── Color Utilities ────────────────────────────────────────────────
function parseRgbString(str) {
  if (!str) return null;
  const match = str.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
  }
  return null;
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

function colorToHex(cssColor) {
  const rgb = parseRgbString(cssColor);
  if (rgb) return rgbToHex(rgb.r, rgb.g, rgb.b);
  return cssColor || 'transparent';
}

function parsePx(value) {
  if (!value) return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 0 : Math.round(num * 100) / 100;
}

// ─── Selector Builder ───────────────────────────────────────────────
function buildSelector(el) {
  if (!el) return '';
  let sel = el.tag || '';
  if (el.id) sel += `#${el.id}`;
  if (el.className) {
    const classes = el.className.split(/\s+/).filter(Boolean).slice(0, 3);
    sel += classes.map((c) => `.${c}`).join('');
  }
  return sel;
}

// ─── Text Similarity ────────────────────────────────────────────────
function textSimilarity(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;

  // Jaccard similarity on words
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

// ─── Normalize font family for comparison ───────────────────────────
function normalizeFontFamily(ff) {
  if (!ff) return [];
  return ff
    .split(',')
    .map((f) => f.trim().replace(/["']/g, '').toLowerCase())
    .filter(Boolean);
}

function fontFamilyCoreMatch(ff1, ff2) {
  const fonts1 = normalizeFontFamily(ff1);
  const fonts2 = normalizeFontFamily(ff2);
  if (fonts1.length === 0 || fonts2.length === 0) return true;

  const strip = (s) => s.replace(/[\s_\-]/g, '');
  for (const f1 of fonts1) {
    for (const f2 of fonts2) {
      if (strip(f1) === strip(f2)) return true;
      if (strip(f1).includes(strip(f2)) || strip(f2).includes(strip(f1))) return true;
    }
  }
  return false;
}

// ─── Normalize text-align ───────────────────────────────────────────
function normalizeTextAlign(value, el) {
  if (!value) return 'left';
  let align = value.toLowerCase().trim();
  if (align === 'start') align = 'left';
  if (align === 'end') align = 'right';
  // Check flex/grid centering
  if (align === 'left' && el && el.styles) {
    const d = el.styles.display || '';
    if ((d.includes('flex') || d.includes('grid')) &&
      (el.styles.justifyContent === 'center' || el.styles.alignItems === 'center')) {
      align = 'center';
    }
  }
  return align;
}

// ─── Match Elements Between Pages ───────────────────────────────────
/**
 * Match elements from reference page to live page based on:
 * 1. Same text content (highest priority)
 * 2. Same selector (tag + class + id)
 * 3. Similar position on page
 */
function matchElements(refElements, liveElements) {
  const refText = refElements.filter((e) => e.elementType === 'text' && e.text);
  const liveText = liveElements.filter((e) => e.elementType === 'text' && e.text);

  const matched = [];
  const usedLive = new Set();

  for (const ref of refText) {
    let bestMatch = null;
    let bestScore = 0;

    for (let i = 0; i < liveText.length; i++) {
      if (usedLive.has(i)) continue;
      const live = liveText[i];

      // Text similarity
      const textScore = textSimilarity(ref.text, live.text);
      if (textScore < 0.3) continue;

      // Selector match bonus
      const refSel = buildSelector(ref);
      const liveSel = buildSelector(live);
      const selectorBonus = refSel === liveSel ? 0.2 : 0;

      // Position similarity bonus (relative Y position)
      const refY = ref.bounds.top;
      const liveY = live.bounds.top;
      const yDiff = Math.abs(refY - liveY);
      const posBonus = yDiff < 50 ? 0.1 : yDiff < 200 ? 0.05 : 0;

      const totalScore = textScore + selectorBonus + posBonus;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestMatch = { index: i, element: live };
      }
    }

    if (bestMatch && bestScore >= 0.4) {
      matched.push({
        ref,
        live: bestMatch.element,
        matchScore: bestScore,
      });
      usedLive.add(bestMatch.index);
    }
  }

  return matched;
}

// ─── Compare Two HTML Pages ─────────────────────────────────────────
function compareHtmlPages(refData, liveData) {
  const issues = [];
  const matches = [];

  // Only compare elements inside <main> — skip header/footer/nav
  const refElements = refData.elements.filter((e) => e.insideMain);
  const liveElements = liveData.elements.filter((e) => e.insideMain);

  // Step 1: Match text elements between pages
  const matchedPairs = matchElements(refElements, liveElements);

  // Step 2: Compare matched pairs
  for (const { ref, live, matchScore } of matchedPairs) {
    const selector = buildSelector(live);
    const textPreview = (live.text || '').substring(0, 50);

    // ── Font Family ──
    const refFF = normalizeFontFamily(ref.styles.fontFamily);
    const liveFF = normalizeFontFamily(live.styles.fontFamily);
    if (!fontFamilyCoreMatch(ref.styles.fontFamily, live.styles.fontFamily)) {
      issues.push({
        type: 'font',
        category: 'fonts',
        priority: 'high',
        message: `Font family mismatch on "${textPreview}"`,
        element: selector,
        psdValue: refFF[0] || ref.styles.fontFamily,
        htmlValue: liveFF[0] || live.styles.fontFamily,
        refValue: refFF[0] || ref.styles.fontFamily,
        liveValue: liveFF[0] || live.styles.fontFamily,
        difference: `${refFF[0]} → ${liveFF[0]}`,
        htmlBounds: live.bounds,
      });
    } else {
      matches.push({
        type: 'font',
        element: selector,
        psdValue: refFF[0] || 'same',
        htmlValue: liveFF[0] || 'same',
        refValue: refFF[0] || 'same',
        liveValue: liveFF[0] || 'same',
      });
    }

    // ── Font Size ──
    const refSize = parsePx(ref.styles.fontSize);
    const liveSize = parsePx(live.styles.fontSize);
    const sizeDiff = Math.abs(refSize - liveSize);
    if (sizeDiff > 1) {
      issues.push({
        type: 'fontSize',
        category: 'fonts',
        priority: sizeDiff > 4 ? 'high' : 'medium',
        message: `Font size mismatch on "${textPreview}"`,
        element: selector,
        psdValue: `${refSize}px`,
        htmlValue: `${liveSize}px`,
        refValue: `${refSize}px`,
        liveValue: `${liveSize}px`,
        difference: `${sizeDiff.toFixed(1)}px off`,
        htmlBounds: live.bounds,
      });
    } else {
      matches.push({
        type: 'fontSize',
        element: selector,
        psdValue: `${refSize}px`,
        htmlValue: `${liveSize}px`,
        refValue: `${refSize}px`,
        liveValue: `${liveSize}px`,
      });
    }

    // ── Font Weight ──
    const refWeight = String(ref.styles.fontWeight || '400');
    const liveWeight = String(live.styles.fontWeight || '400');
    if (refWeight !== liveWeight) {
      issues.push({
        type: 'fontWeight',
        category: 'fonts',
        priority: 'medium',
        message: `Font weight mismatch on "${textPreview}"`,
        element: selector,
        psdValue: refWeight,
        htmlValue: liveWeight,
        refValue: refWeight,
        liveValue: liveWeight,
        difference: `${refWeight} → ${liveWeight}`,
        htmlBounds: live.bounds,
      });
    } else {
      matches.push({
        type: 'fontWeight',
        element: selector,
        psdValue: refWeight,
        htmlValue: liveWeight,
        refValue: refWeight,
        liveValue: liveWeight,
      });
    }

    // ── Text Color ──
    const refColor = parseRgbString(ref.styles.color);
    const liveColor = parseRgbString(live.styles.color);
    if (refColor && liveColor) {
      const dist = colorDistance(refColor, liveColor);
      if (dist > 15) {
        const refHex = rgbToHex(refColor.r, refColor.g, refColor.b);
        const liveHex = rgbToHex(liveColor.r, liveColor.g, liveColor.b);
        issues.push({
          type: 'color',
          category: 'colors',
          priority: dist > 50 ? 'high' : 'medium',
          message: `Text color mismatch on "${textPreview}"`,
          element: selector,
          psdValue: refHex,
          htmlValue: liveHex,
          refValue: refHex,
          liveValue: liveHex,
          difference: `ΔE ${Math.round(dist)}`,
          htmlBounds: live.bounds,
        });
      } else {
        matches.push({
          type: 'color',
          element: selector,
          psdValue: ref.styles.color,
          htmlValue: live.styles.color,
          refValue: ref.styles.color,
          liveValue: live.styles.color,
        });
      }
    }

    // ── Line Height ──
    const refLH = parsePx(ref.styles.lineHeight);
    const liveLH = parsePx(live.styles.lineHeight);
    if (refLH > 0 && liveLH > 0) {
      const lhDiff = Math.abs(refLH - liveLH);
      if (lhDiff > 2) {
        issues.push({
          type: 'lineHeight',
          category: 'line-height',
          priority: lhDiff > 6 ? 'medium' : 'low',
          message: `Line height mismatch on "${textPreview}"`,
          element: selector,
          psdValue: `${refLH}px`,
          htmlValue: `${liveLH}px`,
          refValue: `${refLH}px`,
          liveValue: `${liveLH}px`,
          difference: `${lhDiff.toFixed(1)}px off`,
          htmlBounds: live.bounds,
        });
      } else {
        matches.push({
          type: 'lineHeight',
          element: selector,
          psdValue: `${refLH}px`,
          htmlValue: `${liveLH}px`,
          refValue: `${refLH}px`,
          liveValue: `${liveLH}px`,
        });
      }
    }

    // ── Letter Spacing ──
    const refLS = parsePx(ref.styles.letterSpacing);
    const liveLS = parsePx(live.styles.letterSpacing);
    const lsDiff = Math.abs(refLS - liveLS);
    if (lsDiff > 0.5) {
      issues.push({
        type: 'letterSpacing',
        category: 'letter-spacing',
        priority: 'low',
        message: `Letter spacing mismatch on "${textPreview}"`,
        element: selector,
        psdValue: `${refLS}px`,
        htmlValue: `${liveLS}px`,
        refValue: `${refLS}px`,
        liveValue: `${liveLS}px`,
        difference: `${lsDiff.toFixed(1)}px off`,
        htmlBounds: live.bounds,
      });
    } else {
      matches.push({
        type: 'letterSpacing',
        element: selector,
        psdValue: `${refLS}px`,
        htmlValue: `${liveLS}px`,
        refValue: `${refLS}px`,
        liveValue: `${liveLS}px`,
      });
    }

    // ── Text Alignment ──
    const refAlign = normalizeTextAlign(ref.styles.textAlign, ref);
    const liveAlign = normalizeTextAlign(live.styles.textAlign, live);
    if (refAlign !== liveAlign) {
      issues.push({
        type: 'textAlign',
        category: 'text-align',
        priority: 'medium',
        message: `Text alignment mismatch on "${textPreview}"`,
        element: selector,
        psdValue: refAlign,
        htmlValue: liveAlign,
        refValue: refAlign,
        liveValue: liveAlign,
        difference: `${refAlign} → ${liveAlign}`,
        htmlBounds: live.bounds,
      });
    } else {
      matches.push({
        type: 'textAlign',
        element: selector,
        psdValue: refAlign,
        htmlValue: liveAlign,
        refValue: refAlign,
        liveValue: liveAlign,
      });
    }
  }

  // Step 3: Compare spacing between matched sections
  const spacingIssues = compareHtmlSpacing(refData, liveData, matchedPairs);
  issues.push(...spacingIssues);

  // Step 4: Compare background colors on sections
  const bgIssues = compareHtmlBackgrounds(refData, liveData);
  issues.push(...bgIssues);

  // Sort by priority
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
    matchedElements: matchedPairs.length,
    matchedTextLayers: matchedPairs.length,
  };

  const total = issues.length + matches.length;
  summary.score = total > 0 ? Math.round((matches.length / total) * 100) : 100;

  const refTextElements = refElements.filter((e) => e.elementType === 'text' && e.text);
  const liveTextElements = liveElements.filter((e) => e.elementType === 'text' && e.text);

  return {
    summary,
    issues,
    matches,
    refInfo: {
      url: refData.url,
      totalElements: refElements.length,
      textElements: refTextElements.length,
      viewport: refData.viewport,
    },
    liveInfo: {
      url: liveData.url,
      totalElements: liveElements.length,
      textElements: liveTextElements.length,
      viewport: liveData.viewport,
    },
    htmlInfo: {
      url: liveData.url,
      totalElements: liveElements.length,
      textElements: liveTextElements.length,
      viewport: liveData.viewport,
      viewportWidth: liveData.viewport ? liveData.viewport.width : 1440,
      pageHeight: liveData.pageInfo ? liveData.pageInfo.pageHeight : null,
      pageWidth: liveData.pageInfo ? liveData.pageInfo.pageWidth : null,
    },
  };
}

// ─── Spacing Comparison (HTML vs HTML) ──────────────────────────────
/**
 * Group matched text elements by their parent sections and compare
 * vertical gaps and padding between reference and live.
 */
function compareHtmlSpacing(refData, liveData, matchedPairs) {
  const issues = [];

  // Group by parent section on the live side
  const sectionGroups = new Map();

  for (const pair of matchedPairs) {
    const liveSection = pair.live.parentSection;
    const refSection = pair.ref.parentSection;
    if (!liveSection || !refSection) continue;

    const sectionKey = buildSelector(liveSection);
    if (!sectionGroups.has(sectionKey)) {
      sectionGroups.set(sectionKey, {
        refSection,
        liveSection,
        pairs: [],
      });
    }
    sectionGroups.get(sectionKey).pairs.push(pair);
  }

  for (const [sectionKey, group] of sectionGroups) {
    const { refSection, liveSection, pairs } = group;
    if (pairs.length < 2) continue;

    // Sort by Y position
    pairs.sort((a, b) => a.live.bounds.top - b.live.bounds.top);

    // Deduplicate: if multiple text elements share the same wrapper (card/box),
    // keep only one representative per wrapper to avoid measuring gaps within cards.
    const deduped = [];
    const seenWrappers = new Set();
    for (const pair of pairs) {
      const wrapKey = pair.live.wrapperSelector || null;
      if (wrapKey && seenWrappers.has(wrapKey)) continue;
      if (wrapKey) seenWrappers.add(wrapKey);
      deduped.push(pair);
    }

    if (deduped.length < 2) continue;

    // Compare vertical gaps between consecutive elements
    for (let i = 0; i < deduped.length - 1; i++) {
      const refA = deduped[i].ref;
      const refB = deduped[i + 1].ref;
      const liveA = deduped[i].live;
      const liveB = deduped[i + 1].live;

      // Use wrapper bounds (card/box) if available, otherwise element bounds.
      // This ensures we measure from the card's outer edge, not from text inside it.
      const liveABottom = liveA.wrapperBounds ? liveA.wrapperBounds.bottom : liveA.bounds.bottom;
      const liveBTop = liveB.wrapperBounds ? liveB.wrapperBounds.top : liveB.bounds.top;
      const refABottom = refA.wrapperBounds ? refA.wrapperBounds.bottom : refA.bounds.bottom;
      const refBTop = refB.wrapperBounds ? refB.wrapperBounds.top : refB.bounds.top;

      const liveATop = liveA.wrapperBounds ? liveA.wrapperBounds.top : liveA.bounds.top;
      const liveBBottom = liveB.wrapperBounds ? liveB.wrapperBounds.bottom : liveB.bounds.bottom;

      const refGap = refBTop - refABottom;
      const liveGap = liveBTop - liveABottom;
      const gapDiff = Math.abs(refGap - liveGap);

      // Skip negative gaps (overlapping/nested elements) or unreasonably large ones
      if (liveGap < 0 || refGap < 0) continue;

      if (gapDiff > 3 && refGap < 300 && liveGap < 300) {
        const liveALeft = liveA.wrapperBounds ? liveA.wrapperBounds.left : liveA.bounds.left;
        const liveARight = liveA.wrapperBounds ? liveA.wrapperBounds.right : liveA.bounds.right;
        const liveBLeft = liveB.wrapperBounds ? liveB.wrapperBounds.left : liveB.bounds.left;
        const liveBRight = liveB.wrapperBounds ? liveB.wrapperBounds.right : liveB.bounds.right;
        const gapLeft = Math.min(liveALeft, liveBLeft);
        const gapRight = Math.max(liveARight, liveBRight);
        const aboveLabel = liveA.wrapperSelector || (liveA.text || '').substring(0, 60) || buildSelector(liveA);
        const belowLabel = liveB.wrapperSelector || (liveB.text || '').substring(0, 60) || buildSelector(liveB);
        issues.push({
          type: 'verticalGap',
          category: 'spacing',
          priority: gapDiff > 15 ? 'high' : gapDiff > 5 ? 'medium' : 'low',
          message: `Vertical gap mismatch between "${aboveLabel}" and "${belowLabel}" in ${sectionKey}`,
          element: sectionKey,
          elementAbove: aboveLabel,
          elementBelow: belowLabel,
          elementAboveSelector: liveA.wrapperSelector || buildSelector(liveA),
          elementBelowSelector: liveB.wrapperSelector || buildSelector(liveB),
          psdValue: `${Math.round(refGap)}px`,
          htmlValue: `${Math.round(liveGap)}px`,
          refValue: `${Math.round(refGap)}px`,
          liveValue: `${Math.round(liveGap)}px`,
          difference: `${Math.round(gapDiff)}px off`,
          htmlBounds: {
            top: liveATop,
            left: gapLeft,
            bottom: liveBBottom,
            right: gapRight,
            width: gapRight - gapLeft,
            height: liveBBottom - liveATop,
          },
          htmlGapBounds: {
            top: liveABottom,
            left: gapLeft,
            bottom: liveBTop,
            right: gapRight,
            width: gapRight - gapLeft,
            height: liveGap,
          },
        });
      }
    }

    // Compare top padding (use deduped list & wrapper bounds)
    const firstRef = deduped[0].ref;
    const firstLive = deduped[0].live;
    const firstLiveTop = firstLive.wrapperBounds ? firstLive.wrapperBounds.top : firstLive.bounds.top;
    const firstRefTop = firstRef.wrapperBounds ? firstRef.wrapperBounds.top : firstRef.bounds.top;
    const firstLiveBottom = firstLive.wrapperBounds ? firstLive.wrapperBounds.bottom : firstLive.bounds.bottom;
    const refTopPad = firstRefTop - refSection.bounds.top;
    const liveTopPad = firstLiveTop - liveSection.bounds.top;
    const topDiff = Math.abs(refTopPad - liveTopPad);

    if (topDiff > 3 && refTopPad < 300 && liveTopPad < 300 && liveTopPad >= 0 && refTopPad >= 0) {
      const firstLabel = firstLive.wrapperSelector || (firstLive.text || '').substring(0, 60) || buildSelector(firstLive);
      issues.push({
        type: 'topPadding',
        category: 'spacing',
        priority: topDiff > 15 ? 'high' : topDiff > 5 ? 'medium' : 'low',
        message: `Top padding mismatch above "${firstLabel}" in ${sectionKey}`,
        element: sectionKey,
        elementBelow: firstLabel,
        elementBelowSelector: firstLive.wrapperSelector || buildSelector(firstLive),
        psdValue: `${Math.round(refTopPad)}px`,
        htmlValue: `${Math.round(liveTopPad)}px`,
        refValue: `${Math.round(refTopPad)}px`,
        liveValue: `${Math.round(liveTopPad)}px`,
        difference: `${Math.round(topDiff)}px off`,
        htmlBounds: {
          top: liveSection.bounds.top,
          left: liveSection.bounds.left,
          bottom: firstLiveBottom,
          right: liveSection.bounds.right,
          width: liveSection.bounds.width,
          height: firstLiveBottom - liveSection.bounds.top,
        },
        htmlGapBounds: {
          top: liveSection.bounds.top,
          left: liveSection.bounds.left,
          bottom: firstLiveTop,
          right: liveSection.bounds.right,
          width: liveSection.bounds.width,
          height: liveTopPad,
        },
      });
    }

    // Compare bottom padding (use deduped list & wrapper bounds)
    const lastRef = deduped[deduped.length - 1].ref;
    const lastLive = deduped[deduped.length - 1].live;
    const lastLiveBottom = lastLive.wrapperBounds ? lastLive.wrapperBounds.bottom : lastLive.bounds.bottom;
    const lastRefBottom = lastRef.wrapperBounds ? lastRef.wrapperBounds.bottom : lastRef.bounds.bottom;
    const lastLiveTop = lastLive.wrapperBounds ? lastLive.wrapperBounds.top : lastLive.bounds.top;
    const refBotPad = refSection.bounds.bottom - lastRefBottom;
    const liveBotPad = liveSection.bounds.bottom - lastLiveBottom;
    const botDiff = Math.abs(refBotPad - liveBotPad);

    if (botDiff > 3 && refBotPad < 300 && liveBotPad < 300 && liveBotPad >= 0 && refBotPad >= 0) {
      const lastLabel = lastLive.wrapperSelector || (lastLive.text || '').substring(0, 60) || buildSelector(lastLive);
      issues.push({
        type: 'bottomPadding',
        category: 'spacing',
        priority: botDiff > 15 ? 'high' : botDiff > 5 ? 'medium' : 'low',
        message: `Bottom padding mismatch below "${lastLabel}" in ${sectionKey}`,
        element: sectionKey,
        elementAbove: lastLabel,
        elementAboveSelector: lastLive.wrapperSelector || buildSelector(lastLive),
        psdValue: `${Math.round(refBotPad)}px`,
        htmlValue: `${Math.round(liveBotPad)}px`,
        refValue: `${Math.round(refBotPad)}px`,
        liveValue: `${Math.round(liveBotPad)}px`,
        difference: `${Math.round(botDiff)}px off`,
        htmlBounds: {
          top: lastLiveTop,
          left: liveSection.bounds.left,
          bottom: liveSection.bounds.bottom,
          right: liveSection.bounds.right,
          width: liveSection.bounds.width,
          height: liveSection.bounds.bottom - lastLiveTop,
        },
        htmlGapBounds: {
          top: lastLiveBottom,
          left: liveSection.bounds.left,
          bottom: liveSection.bounds.bottom,
          right: liveSection.bounds.right,
          width: liveSection.bounds.width,
          height: liveBotPad,
        },
      });
    }
  }

  return issues;
}

// ─── Background Color Comparison (HTML vs HTML) ─────────────────────
/**
 * Compare background colors of container/section elements between pages.
 */
function compareHtmlBackgrounds(refData, liveData) {
  const issues = [];

  const refContainers = refData.elements.filter(
    (e) => e.insideMain && e.elementType === 'container' && e.bounds.height > 50 && e.bounds.width > 200
  );
  const liveContainers = liveData.elements.filter(
    (e) => e.insideMain && e.elementType === 'container' && e.bounds.height > 50 && e.bounds.width > 200
  );

  // Match containers by selector + position
  const usedLive = new Set();
  for (const ref of refContainers) {
    const refSel = buildSelector(ref);
    let bestMatch = null;
    let bestScore = 0;

    for (let i = 0; i < liveContainers.length; i++) {
      if (usedLive.has(i)) continue;
      const live = liveContainers[i];
      const liveSel = buildSelector(live);

      let score = 0;
      if (refSel === liveSel) score += 1;
      // Y-position proximity
      const yDiff = Math.abs(ref.bounds.top - live.bounds.top);
      if (yDiff < 100) score += 0.5;
      else if (yDiff < 300) score += 0.2;

      // Size similarity
      const hDiff = Math.abs(ref.bounds.height - live.bounds.height);
      if (hDiff < 50) score += 0.3;

      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = { index: i, element: live };
      }
    }

    if (!bestMatch) continue;
    usedLive.add(bestMatch.index);
    const live = bestMatch.element;

    const refBg = parseRgbString(ref.styles.backgroundColor);
    const liveBg = parseRgbString(live.styles.backgroundColor);

    if (refBg && liveBg) {
      // Skip transparent/near-transparent
      const refStr = ref.styles.backgroundColor || '';
      const liveStr = live.styles.backgroundColor || '';
      if (refStr.includes('rgba') && refStr.includes(', 0)')) continue;
      if (liveStr.includes('rgba') && liveStr.includes(', 0)')) continue;

      const dist = colorDistance(refBg, liveBg);
      if (dist > 15) {
        const refHex = rgbToHex(refBg.r, refBg.g, refBg.b);
        const liveHex = rgbToHex(liveBg.r, liveBg.g, liveBg.b);
        issues.push({
          type: 'backgroundColor',
          category: 'colors',
          priority: dist > 50 ? 'high' : 'medium',
          message: `Background color mismatch on ${buildSelector(live)}`,
          element: buildSelector(live),
          psdValue: refHex,
          htmlValue: liveHex,
          refValue: refHex,
          liveValue: liveHex,
          difference: `ΔE ${Math.round(dist)}`,
          htmlBounds: live.bounds,
        });
      }
    }
  }

  return issues;
}

module.exports = { compareHtmlPages };
