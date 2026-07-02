/**
 * HTML Analyzer — uses Puppeteer to extract computed styles and layout
 * from a live URL.  Works both locally and in cloud environments
 * (passes --no-sandbox for Render / Railway / Docker).
 */

const puppeteer = require('puppeteer');

// ─── Browser Args ────────────────────────────────────────────────────
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--single-process',
  '--no-zygote',
];

// ─── Element Extractor (runs inside the page) ─────────────────────────
const EXTRACT_ELEMENTS = () => {
  const SELECTORS = [
    'h1','h2','h3','h4','h5','h6',
    'p','span','a','button','input','textarea','select',
    'img','svg','video',
    'header','footer','nav','main','section','article','aside',
    'div','ul','ol','li','table','tr','td','th',
  ];

  const STYLE_PROPS = [
    'fontFamily','fontSize','fontWeight','fontStyle','color',
    'backgroundColor','letterSpacing','lineHeight','textAlign',
    'marginTop','marginRight','marginBottom','marginLeft',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'display','position','borderRadius','opacity','zIndex',
    'width','height','top','left','right','bottom',
    'borderColor','borderWidth','borderStyle',
    'boxShadow','textDecoration',
  ];

  const results = [];

  for (const sel of SELECTORS) {
    document.querySelectorAll(sel).forEach((el) => {
      const rect   = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const styles = window.getComputedStyle(el);
      const styleObj = {};
      for (const p of STYLE_PROPS) styleObj[p] = styles[p];

      results.push({
        tag:       el.tagName.toLowerCase(),
        id:        el.id        || '',
        className: typeof el.className === 'string' ? el.className : '',
        text:      (el.innerText || '').slice(0, 300),
        src:       el.src  || el.href || '',
        alt:       el.alt  || '',
        bounds: {
          left:   Math.round(rect.left),
          top:    Math.round(rect.top),
          right:  Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width:  Math.round(rect.width),
          height: Math.round(rect.height),
        },
        styles: styleObj,
      });
    });
  }

  // Deduplicate by position + tag
  const seen = new Set();
  return results.filter((el) => {
    const key = `${el.tag}|${el.bounds.left}|${el.bounds.top}|${el.bounds.width}|${el.bounds.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ─── Public API ──────────────────────────────────────────────────────
async function analyzeHTML(url, viewportWidth = 1440, viewportHeight = 900) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: BROWSER_ARGS,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: viewportWidth, height: viewportHeight });

    // Ignore images / fonts to speed things up
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) req.abort();
      else req.continue();
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait briefly for any JS-rendered content
    await page.waitForSelector('body', { timeout: 5_000 }).catch(() => {});

    const elements = await page.evaluate(EXTRACT_ELEMENTS);

    // Take a screenshot (re-enable images would be ideal but this is fine as overview)
    let screenshot = null;
    try {
      // Temporarily allow images for the screenshot
      screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
    } catch (_) { /* screenshot is optional */ }

    return { elements, screenshot };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { analyzeHTML };
