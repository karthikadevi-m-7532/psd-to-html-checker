// ─── API Base URL ───────────────────────────────────────────────
const API_BASE = 'http://localhost:8888';

// ─── DOM Elements ───────────────────────────────────────────────
const dropzone = document.getElementById('dropzone');
const psdFileInput = document.getElementById('psd-file');
const browseBtn = document.getElementById('browse-btn');
const removeBtn = document.getElementById('remove-btn');
const fileInfo = document.getElementById('file-info');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const urlInput = document.getElementById('url-input');
const viewportWidth = document.getElementById('viewport-width');
const viewportHeight = document.getElementById('viewport-height');
const compareBtn = document.getElementById('compare-btn');
const loadingSection = document.getElementById('loading-section');
const loadingTitle = document.getElementById('loading-title');
const loadingStatus = document.getElementById('loading-status');
const progressFill = document.getElementById('progress-fill');
const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');
const errorClose = document.getElementById('error-close');
const resultsSection = document.getElementById('results-section');
const scoreValue = document.getElementById('score-value');
const scoreRing = document.getElementById('score-ring');
const scoreSummary = document.getElementById('score-summary');
const scoreMeta = document.getElementById('score-meta');
const issuesContainer = document.getElementById('issues-container');

// HTML vs HTML mode elements
const psdHtmlSection = document.getElementById('psd-html-section');
const htmlHtmlSection = document.getElementById('html-html-section');
const refUrlInput = document.getElementById('ref-url-input');
const liveUrlInput = document.getElementById('live-url-input');
const hhViewportWidth = document.getElementById('hh-viewport-width');
const hhViewportHeight = document.getElementById('hh-viewport-height');
const compareHtmlBtn = document.getElementById('compare-html-btn');

let selectedFile = null;
let currentReport = null;
let currentMode = 'psd-html'; // 'psd-html' or 'html-html'

// ─── Mode Tabs ──────────────────────────────────────────────────

document.querySelectorAll('.mode-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    currentMode = tab.dataset.mode;

    // Toggle sections
    if (currentMode === 'psd-html') {
      psdHtmlSection.classList.remove('hidden');
      htmlHtmlSection.classList.add('hidden');
    } else {
      psdHtmlSection.classList.add('hidden');
      htmlHtmlSection.classList.remove('hidden');
    }

    // Hide results & errors when switching modes
    resultsSection.classList.add('hidden');
    hideError();
  });
});

// ─── HTML vs HTML compare button state ──────────────────────────

refUrlInput.addEventListener('input', updateHtmlCompareButton);
liveUrlInput.addEventListener('input', updateHtmlCompareButton);

function updateHtmlCompareButton() {
  compareHtmlBtn.disabled = !(refUrlInput.value.trim() && liveUrlInput.value.trim());
}

compareHtmlBtn.addEventListener('click', startHtmlComparison);

// ─── File Upload ────────────────────────────────────────────────

browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  psdFileInput.click();
});

dropzone.addEventListener('click', () => {
  if (!selectedFile) psdFileInput.click();
});

psdFileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

// Drag and drop
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.psd')) {
    showError('Please upload a .psd file');
    return;
  }

  if (file.size > 1024 * 1024 * 1024) {
    showError('File size exceeds 1GB limit');
    return;
  }

  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);

  dropzone.querySelector('.dropzone-content').classList.add('hidden');
  fileInfo.classList.remove('hidden');

  updateCompareButton();
}

removeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  selectedFile = null;
  psdFileInput.value = '';
  dropzone.querySelector('.dropzone-content').classList.remove('hidden');
  fileInfo.classList.add('hidden');
  updateCompareButton();
});

// ─── URL Input ──────────────────────────────────────────────────

urlInput.addEventListener('input', updateCompareButton);

function updateCompareButton() {
  compareBtn.disabled = !(selectedFile && urlInput.value.trim());
}

// ─── Compare Action ─────────────────────────────────────────────

compareBtn.addEventListener('click', startComparison);

async function startComparison() {
  hideError();
  resultsSection.classList.add('hidden');

  const url = urlInput.value.trim();
  if (!selectedFile || !url) return;

  // Show loading
  loadingSection.classList.remove('hidden');
  compareBtn.disabled = true;
  updateLoadingState('Uploading PSD file...', 10);

  const formData = new FormData();
  formData.append('psdFile', selectedFile);
  formData.append('url', url);
  formData.append('viewportWidth', viewportWidth.value || '1440');
  formData.append('viewportHeight', viewportHeight.value || '900');

  try {
    updateLoadingState('Parsing PSD file...', 25);

    const response = await fetch(API_BASE + '/api/compare', {
      method: 'POST',
      body: formData,
    });

    updateLoadingState('Analyzing HTML page...', 50);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Comparison failed');
    }

    updateLoadingState('Generating report...', 85);

    // Small delay for UX
    await new Promise((r) => setTimeout(r, 500));

    updateLoadingState('Done!', 100);

    await new Promise((r) => setTimeout(r, 300));

    currentReport = data;
    renderReport(data);
  } catch (err) {
    showError(err.message);
  } finally {
    loadingSection.classList.add('hidden');
    compareBtn.disabled = false;
    progressFill.style.width = '0%';
  }
}

function updateLoadingState(status, progress) {
  loadingStatus.textContent = status;
  progressFill.style.width = progress + '%';
}

// ─── HTML vs HTML Comparison ────────────────────────────────────

async function startHtmlComparison() {
  hideError();
  resultsSection.classList.add('hidden');

  const refUrl = refUrlInput.value.trim();
  const liveUrl = liveUrlInput.value.trim();
  if (!refUrl || !liveUrl) return;

  // Show loading
  loadingSection.classList.remove('hidden');
  compareHtmlBtn.disabled = true;
  updateLoadingState('Analyzing reference URL...', 10);

  try {
    updateLoadingState('Analyzing both HTML pages...', 25);

    const response = await fetch(API_BASE + '/api/compare-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refUrl,
        liveUrl,
        viewportWidth: hhViewportWidth.value || '1440',
        viewportHeight: hhViewportHeight.value || '900',
      }),
    });

    updateLoadingState('Comparing pages...', 60);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Comparison failed');
    }

    updateLoadingState('Generating report...', 85);
    await new Promise((r) => setTimeout(r, 500));
    updateLoadingState('Done!', 100);
    await new Promise((r) => setTimeout(r, 300));

    currentReport = data;
    renderReport(data);
  } catch (err) {
    showError(err.message);
  } finally {
    loadingSection.classList.add('hidden');
    compareHtmlBtn.disabled = false;
    progressFill.style.width = '0%';
  }
}

// ─── Render Report ──────────────────────────────────────────────

function renderReport(report) {
  resultsSection.classList.remove('hidden');

  // Score
  const score = report.summary.score;
  scoreValue.textContent = score;

  // Animate the ring
  const circumference = 2 * Math.PI * 54; // r = 54
  const offset = circumference - (score / 100) * circumference;
  scoreRing.style.strokeDashoffset = offset;

  // Score color
  if (score >= 80) {
    scoreRing.style.stroke = 'var(--green)';
    scoreValue.style.color = 'var(--green)';
  } else if (score >= 60) {
    scoreRing.style.stroke = 'var(--yellow)';
    scoreValue.style.color = 'var(--yellow)';
  } else if (score >= 40) {
    scoreRing.style.stroke = 'var(--orange)';
    scoreValue.style.color = 'var(--orange)';
  } else {
    scoreRing.style.stroke = 'var(--red)';
    scoreValue.style.color = 'var(--red)';
  }

  // Summary text
  const s = report.summary;
  if (currentMode === 'html-html') {
    scoreSummary.textContent = `Found ${s.totalIssues} issues and ${s.totalMatches} matches across ${s.matchedTextLayers || s.matchedElements || 0} matched elements.`;
  } else {
    scoreSummary.textContent = `Found ${s.totalIssues} issues and ${s.totalMatches} matches across ${s.matchedTextLayers} matched text layers.`;
  }

  // Stats
  document.querySelector('#stat-critical .stat-count').textContent = s.critical;
  document.querySelector('#stat-high .stat-count').textContent = s.high;
  document.querySelector('#stat-medium .stat-count').textContent = s.medium;
  document.querySelector('#stat-low .stat-count').textContent = s.low;

  // Meta
  if (currentMode === 'html-html') {
    scoreMeta.innerHTML = `
      Reference: ${report.refInfo?.totalElements || '?'} elements (${report.refInfo?.textElements || '?'} text) &bull;
      Live: ${report.liveInfo?.totalElements || '?'} elements (${report.liveInfo?.textElements || '?'} text) &bull;
      Processed in ${report.processingTime}
    `;
  } else {
    scoreMeta.innerHTML = `
      PSD: ${report.psdInfo.width}×${report.psdInfo.height}px, ${report.psdInfo.totalLayers} layers (${report.psdInfo.textLayers} text) &bull;
      HTML: ${report.htmlInfo.totalElements} elements (${report.htmlInfo.textElements} text) &bull;
      Processed in ${report.processingTime}
    `;
  }

  // Tab counts
  document.getElementById('tab-count-all').textContent = report.issues.length;
  document.getElementById('tab-count-fonts').textContent = report.issues.filter((i) => i.category === 'fonts').length;
  document.getElementById('tab-count-colors').textContent = report.issues.filter((i) => i.category === 'colors').length;
  document.getElementById('tab-count-text-align').textContent = report.issues.filter((i) => i.category === 'text-align').length;
  document.getElementById('tab-count-line-height').textContent = report.issues.filter((i) => i.category === 'line-height').length;
  document.getElementById('tab-count-letter-spacing').textContent = report.issues.filter((i) => i.category === 'letter-spacing').length;
  document.getElementById('tab-count-spacing').textContent = report.issues.filter((i) => i.category === 'spacing').length;
  document.getElementById('tab-count-matches').textContent = report.matches.length;

  // Render issues
  renderIssues('all');

  // Scroll to results
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Tabs ───────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    renderIssues(tab.dataset.tab);
  });
});

function renderIssues(filter) {
  if (!currentReport) return;

  issuesContainer.innerHTML = '';

  if (filter === 'matches') {
    // Render matches
    const matches = currentReport.matches;
    if (matches.length === 0) {
      issuesContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🤷</div>
          <p>No matches found</p>
        </div>`;
      return;
    }

    for (const match of matches) {
      issuesContainer.appendChild(createMatchCard(match));
    }
    return;
  }

  // Filter issues
  let issues = currentReport.issues;
  if (filter !== 'all') {
    issues = issues.filter((i) => i.category === filter);
  }

  if (issues.length === 0) {
    issuesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <p>No issues found in this category — great work!</p>
      </div>`;
    return;
  }

  for (const issue of issues) {
    issuesContainer.appendChild(createIssueCard(issue));
  }
}

function createIssueCard(issue) {
  const card = document.createElement('div');
  card.className = `issue-card priority-${issue.priority}`;

  const isColor = issue.type === 'color' || issue.type === 'backgroundColor';
  const isSpacing = issue.category === 'spacing';
  const isHtmlMode = currentMode === 'html-html';

  const leftLabel = isHtmlMode ? 'Reference (Prezoho)' : 'PSD Design';
  const rightLabel = isHtmlMode ? 'Live Implementation' : 'HTML Implementation';
  const leftValue = issue.psdValue || issue.refValue || 'N/A';
  const rightValue = issue.htmlValue || issue.liveValue || 'N/A';

  const leftSwatch = isColor ? `<span class="color-swatch" style="background:${leftValue}"></span>` : '';
  const rightSwatch = isColor ? `<span class="color-swatch" style="background:${rightValue}"></span>` : '';

  // For spacing issues, show element flow with arrow icon
  const spacingIcon = isSpacing ? '<span class="spacing-icon">↕</span>' : '';

  // Build spacing location hint
  let spacingContext = '';
  if (isSpacing && (issue.elementAbove || issue.elementBelow)) {
    const above = issue.elementAbove ? `<span class="spacing-el">${escapeHtml(issue.elementAbove)}</span>` : `<span class="spacing-el">section top</span>`;
    const below = issue.elementBelow ? `<span class="spacing-el">${escapeHtml(issue.elementBelow)}</span>` : `<span class="spacing-el">section bottom</span>`;
    spacingContext = `<div class="spacing-context">${above} <span class="spacing-arrow">↕</span> ${below}</div>`;
  }

  card.innerHTML = `
    <div class="issue-header">
      <span class="issue-badge badge-${issue.priority}">${issue.priority}</span>
      <span class="issue-type">${spacingIcon}${issue.type}</span>
      ${issue.element ? `<span class="issue-element selector-code">${escapeHtml(issue.element)}</span>` : ''}
    </div>
    <p class="issue-message">${escapeHtml(issue.message)}</p>
    ${spacingContext}
    <div class="issue-comparison">
      <div class="comparison-box">
        <div class="comparison-label">${leftLabel}</div>
        <div class="comparison-value psd-value">${leftSwatch}${escapeHtml(leftValue)}</div>
        ${issue.psdLayer ? `<div class="comparison-detail"><span class="psd-layer-label">Layer:</span> ${escapeHtml(issue.psdLayer)}</div>` : ''}
      </div>
      <div class="comparison-box">
        <div class="comparison-label">${rightLabel}</div>
        <div class="comparison-value html-value">${rightSwatch}${escapeHtml(rightValue)}</div>
        ${issue.htmlSelector ? `<div class="comparison-detail selector-code">${escapeHtml(issue.htmlSelector)}</div>` : ''}
      </div>
    </div>
    ${issue.difference ? `<div class="issue-diff">Difference: <strong>${escapeHtml(issue.difference)}</strong></div>` : ''}
    <button class="more-details-btn"><span class="icon">🔍</span> More Details</button>
  `;

  // Wire up the More Details button
  card.querySelector('.more-details-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openDetailModal(issue);
  });

  return card;
}

function createMatchCard(match) {
  const card = document.createElement('div');
  card.className = 'issue-card match-card';

  const isColor = match.type === 'color' || match.type === 'backgroundColor';
  const isHtmlMode = currentMode === 'html-html';
  const matchValue = match.psdValue || match.refValue || 'N/A';
  const swatch = isColor ? `<span class="color-swatch" style="background:${matchValue}"></span>` : '';

  const leftLabel = isHtmlMode ? 'Reference (Prezoho)' : 'PSD Design';
  const rightLabel = isHtmlMode ? 'Live Implementation' : 'HTML Implementation';
  const matchContext = isHtmlMode ? 'reference and live' : 'design and implementation';

  card.innerHTML = `
    <div class="issue-header">
      <span class="issue-badge badge-match">✓ match</span>
      <span class="issue-type">${match.type}</span>
    </div>
    <p class="issue-message">
      <span class="selector-code">${escapeHtml((match.element || '').substring(0, 60))}</span> — 
      ${match.type} matches between ${matchContext}
    </p>
    <div class="issue-comparison">
      <div class="comparison-box">
        <div class="comparison-label">${leftLabel}</div>
        <div class="comparison-value match-value">${swatch}${escapeHtml(matchValue)}</div>
      </div>
      <div class="comparison-box">
        <div class="comparison-label">${rightLabel}</div>
        <div class="comparison-value match-value">${swatch}${escapeHtml(match.htmlValue || match.liveValue || 'N/A')}</div>
      </div>
    </div>
  `;

  return card;
}

// ─── Error Handling ─────────────────────────────────────────────

function showError(msg) {
  errorMessage.textContent = msg;
  errorBanner.classList.remove('hidden');
}

function hideError() {
  errorBanner.classList.add('hidden');
}

errorClose.addEventListener('click', hideError);

// ─── Utilities ──────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Detail Modal ───────────────────────────────────────────────

const detailModal = document.getElementById('detail-modal');
const modalClose = document.getElementById('modal-close');
const modalBadge = document.getElementById('modal-badge');
const modalType = document.getElementById('modal-type');
const modalElement = document.getElementById('modal-element');
const modalCanvas = document.getElementById('modal-canvas');
const modalDetails = document.getElementById('modal-details');

// Close modal
modalClose.addEventListener('click', () => detailModal.classList.remove('active'));
detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) detailModal.classList.remove('active');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') detailModal.classList.remove('active');
});

/**
 * Open the detail modal for an issue.
 * Crops the full page screenshot around the element and draws a red highlight.
 */
function openDetailModal(issue) {
  // Header
  modalBadge.textContent = issue.priority;
  modalBadge.className = `modal-badge badge-${issue.priority}`;
  modalType.textContent = issue.type;
  modalElement.textContent = issue.element || '';

  // Draw cropped screenshot with highlight
  drawIssueScreenshot(issue);

  // Build detail rows — only the essentials
  const isColor = issue.type === 'color' || issue.type === 'backgroundColor';
  const isHtmlMode = currentMode === 'html-html';
  const leftLabel = isHtmlMode ? 'Reference Value' : 'PSD Value';
  const rightLabel = isHtmlMode ? 'Live Value' : 'HTML Value';
  const leftValue = issue.psdValue || issue.refValue || 'N/A';
  const rightValue = issue.htmlValue || issue.liveValue || 'N/A';
  let detailsHtml = '';

  detailsHtml += detailRow('Issue Type', escapeHtml(issue.type));

  // For spacing issues, show which elements the gap is between
  if (issue.category === 'spacing') {
    if (issue.elementAbove) {
      detailsHtml += detailRow('Element Above', `<span class="selector-code">${escapeHtml(issue.elementAbove)}</span>`);
    }
    if (issue.elementBelow) {
      detailsHtml += detailRow('Element Below', `<span class="selector-code">${escapeHtml(issue.elementBelow)}</span>`);
    }
    if (issue.element) {
      detailsHtml += detailRow('Section', `<span class="selector-code">${escapeHtml(issue.element)}</span>`);
    }
  }

  if (isColor) {
    detailsHtml += detailRow(leftLabel, `<span class="color-dot" style="background:${leftValue}"></span>${escapeHtml(leftValue)}`);
    detailsHtml += detailRow(rightLabel, `<span class="color-dot" style="background:${rightValue}"></span>${escapeHtml(rightValue)}`);
  } else {
    detailsHtml += detailRow(leftLabel, escapeHtml(leftValue));
    detailsHtml += detailRow(rightLabel, escapeHtml(rightValue));
  }

  if (issue.difference) {
    detailsHtml += detailRow('Difference', `<strong>${escapeHtml(issue.difference)}</strong>`);
  }

  modalDetails.innerHTML = detailsHtml;

  // Show modal
  detailModal.classList.add('active');
}

function detailRow(label, value, isSelector) {
  return `
    <div class="modal-detail-row">
      <div class="modal-detail-label">${label}</div>
      <div class="modal-detail-value ${isSelector ? 'selector-code' : ''}">${value}</div>
    </div>
  `;
}

/**
 * Draw a cropped region of the full page screenshot on the modal canvas,
 * with the issue element highlighted with a red border.
 */
function drawIssueScreenshot(issue) {
  const canvas = modalCanvas;
  const ctx = canvas.getContext('2d');

  if (!currentReport || !currentReport.screenshot || !issue.htmlBounds) {
    canvas.width = 400;
    canvas.height = 100;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, 400, 100);
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No screenshot data available for this element', 200, 55);
    return;
  }

  const img = new Image();
  img.onload = () => {
    const b = issue.htmlBounds;
    const isSpacing = issue.category === 'spacing';
    const gap = issue.htmlGapBounds; // Only for spacing issues

    // Scale from CSS px to screenshot image px
    const scaleX = img.width / (currentReport.htmlInfo?.viewportWidth || 1440);
    const scaleY = img.height / (currentReport.htmlInfo?.pageHeight || img.height);

    // Full context bounds in image coordinates (for cropping)
    const elX = Math.round(b.left * scaleX);
    const elY = Math.round(b.top * scaleY);
    const elW = Math.round(b.width * scaleX);
    const elH = Math.round(b.height * scaleY);

    // Crop area: add padding around the element
    const pad = isSpacing ? 40 : 80;
    const cropX = Math.max(0, elX - pad);
    const cropY = Math.max(0, elY - pad);
    const cropR = Math.min(img.width, elX + elW + pad);
    const cropB = Math.min(img.height, elY + elH + pad);
    const cropW = cropR - cropX;
    const cropH = cropB - cropY;

    // Canvas size (limit max size for performance)
    const maxCanvasW = 760;
    const displayScale = Math.min(1, maxCanvasW / cropW);
    canvas.width = Math.round(cropW * displayScale);
    canvas.height = Math.round(cropH * displayScale);

    // Draw cropped screenshot
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

    if (isSpacing && gap) {
      // For spacing issues: highlight only the gap between rows
      const gapY = Math.round(gap.top * scaleY);
      const gapH = Math.round(gap.height * scaleY);
      const gapX = Math.round(gap.left * scaleX);
      const gapW = Math.round(gap.width * scaleX);

      const hlX = (gapX - cropX) * displayScale;
      const hlY = (gapY - cropY) * displayScale;
      const hlW = gapW * displayScale;
      const hlH = Math.max(gapH * displayScale, 4); // Minimum 4px visible

      // Draw semi-transparent red fill over the gap
      ctx.fillStyle = 'rgba(255, 68, 68, 0.25)';
      ctx.fillRect(hlX, hlY, hlW, hlH);

      // Dashed lines at top and bottom of gap
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(hlX, hlY);
      ctx.lineTo(hlX + hlW, hlY);
      ctx.moveTo(hlX, hlY + hlH);
      ctx.lineTo(hlX + hlW, hlY + hlH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrow + label showing the gap value
      const midY = hlY + hlH / 2;
      const midX = hlX + hlW / 2;

      // Vertical arrow
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(midX, hlY + 2);
      ctx.lineTo(midX, hlY + hlH - 2);
      ctx.stroke();
      // Arrow heads
      ctx.beginPath();
      ctx.moveTo(midX - 5, hlY + 8);
      ctx.lineTo(midX, hlY + 2);
      ctx.lineTo(midX + 5, hlY + 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(midX - 5, hlY + hlH - 8);
      ctx.lineTo(midX, hlY + hlH - 2);
      ctx.lineTo(midX + 5, hlY + hlH - 8);
      ctx.stroke();

      // Gap value label
      const labelText = issue.htmlValue || '';
      ctx.fillStyle = '#ff4444';
      const labelW = ctx.measureText(labelText).width + 12;
      ctx.fillRect(midX + 12, midY - 9, labelW, 18);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(labelText, midX + 18, midY + 4);

    } else {
      // For non-spacing issues: highlight the element with overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Clear the element area (punch through the overlay)
      const hlX = (elX - cropX) * displayScale;
      const hlY = (elY - cropY) * displayScale;
      const hlW = elW * displayScale;
      const hlH = elH * displayScale;
      ctx.drawImage(img, elX, elY, elW, elH, hlX, hlY, hlW, hlH);

      // Red highlight border
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(hlX, hlY, hlW, hlH);
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = '#ff4444';
      ctx.fillRect(hlX, hlY - 20, Math.min(hlW, 200), 18);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(issue.type, hlX + 4, hlY - 6);
    }
  };
  img.src = currentReport.screenshot;
}
