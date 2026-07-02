# PSD vs HTML Comparator - Project Instructions

## Project Overview
A web-based design QA tool that compares PSD design files against live HTML implementations, analyzing spacing, fonts, colors, and layout properties.

## Tech Stack
- **Runtime:** Node.js
- **Backend:** Express.js
- **PSD Parsing:** ag-psd
- **HTML Analysis:** Puppeteer
- **File Uploads:** Multer
- **Frontend:** Vanilla HTML/CSS/JavaScript (dark theme UI)

## Project Structure
- `server.js` – Express server entry point
- `public/` – Frontend assets (HTML, CSS, JS)
- `services/` – Backend logic (PSD parsing, HTML analysis, comparison engine)
- `uploads/` – Temporary file uploads directory

## Development
- Run with: `node server.js`
- Server starts on port 3000
- Navigate to http://localhost:3000

## Key Features
- Upload PSD files and extract design properties (fonts, colors, spacing, layers)
- Enter a URL and extract computed CSS styles via Puppeteer
- Compare design vs implementation and report mismatches
- Visual comparison report with categorized issues