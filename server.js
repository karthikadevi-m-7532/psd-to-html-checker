const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parsePSD } = require('./services/psdParser');
const { analyzeHTML } = require('./services/htmlAnalyzer');
const { compareDesigns } = require('./services/comparisonEngine');
const { compareHtmlPages } = require('./services/htmlComparisonEngine');

const app = express();
const PORT = process.env.PORT || 8888;

// ─── Middleware ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── File Upload Config ─────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.psd') {
      cb(null, true);
    } else {
      cb(new Error('Only .psd files are allowed'));
    }
  },
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB max
});

// ─── Routes ─────────────────────────────────────────────────────────

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main comparison endpoint
app.post('/api/compare', upload.single('psdFile'), async (req, res) => {
  const startTime = Date.now();

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a PSD file' });
    }

    const { url, viewportWidth, viewportHeight } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Please provide a URL to compare against' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format. Please provide a valid URL (e.g., https://example.com)' });
    }

    console.log(`\n🔍 Starting comparison...`);
    console.log(`   PSD: ${req.file.originalname}`);
    console.log(`   URL: ${url}`);

    // Step 1: Parse PSD
    console.log('   📄 Parsing PSD file...');
    const psdData = parsePSD(req.file.path);
    console.log(`   ✅ PSD parsed: ${psdData.layers.length} layers (${psdData.width}x${psdData.height})`);

    // Step 2: Analyze HTML
    const vw = parseInt(viewportWidth) || psdData.width || 1440;
    const vh = parseInt(viewportHeight) || 900;
    console.log(`   🌐 Analyzing HTML at viewport ${vw}x${vh}...`);
    const htmlData = await analyzeHTML(url, vw, vh);
    console.log(`   ✅ HTML analyzed: ${htmlData.elements.length} elements`);

    // Step 3: Compare
    console.log('   ⚖️  Comparing designs...');
    const report = compareDesigns(psdData, htmlData);
    report.screenshot = htmlData.screenshot;
    report.processingTime = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
    console.log(`   ✅ Comparison complete: ${report.summary.totalIssues} issues found (score: ${report.summary.score}/100)`);

    res.json(report);
  } catch (err) {
    console.error('❌ Comparison failed:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up uploaded file
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

// Parse PSD only (for preview)
app.post('/api/parse-psd', upload.single('psdFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a PSD file' });
    }

    const psdData = parsePSD(req.file.path);
    res.json(psdData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

// HTML vs HTML comparison endpoint
app.post('/api/compare-html', async (req, res) => {
  const startTime = Date.now();

  try {
    const { refUrl, liveUrl, viewportWidth, viewportHeight } = req.body;

    if (!refUrl || !liveUrl) {
      return res.status(400).json({ error: 'Please provide both reference and live URLs' });
    }

    // Validate URLs
    try { new URL(refUrl); } catch { return res.status(400).json({ error: 'Invalid reference URL format' }); }
    try { new URL(liveUrl); } catch { return res.status(400).json({ error: 'Invalid live URL format' }); }

    const vw = parseInt(viewportWidth) || 1440;
    const vh = parseInt(viewportHeight) || 900;

    console.log(`\n🔍 Starting HTML vs HTML comparison...`);
    console.log(`   Reference: ${refUrl}`);
    console.log(`   Live: ${liveUrl}`);
    console.log(`   Viewport: ${vw}x${vh}`);

    // Step 1: Analyze reference HTML
    console.log('   🔗 Analyzing reference URL...');
    const refData = await analyzeHTML(refUrl, vw, vh);
    console.log(`   ✅ Reference analyzed: ${refData.elements.length} elements`);

    // Step 2: Analyze live HTML
    console.log('   🌐 Analyzing live URL...');
    const liveData = await analyzeHTML(liveUrl, vw, vh);
    console.log(`   ✅ Live analyzed: ${liveData.elements.length} elements`);

    // Step 3: Compare
    console.log('   ⚖️  Comparing pages...');
    const report = compareHtmlPages(refData, liveData);
    report.screenshot = liveData.screenshot;
    report.refScreenshot = refData.screenshot;
    report.processingTime = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
    console.log(`   ✅ Comparison complete: ${report.summary.totalIssues} issues found (score: ${report.summary.score}/100)`);

    res.json(report);
  } catch (err) {
    console.error('❌ HTML comparison failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Error Handler ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 1GB limit' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message === 'Only .psd files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start Server ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 PSD vs HTML Comparator running at http://localhost:${PORT}`);
  console.log(`   Upload a PSD file and enter a URL to start comparing!\n`);
});
