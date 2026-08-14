import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';
import puppeteer from 'puppeteer-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const docsToConvert = [
  {
    mdName: 'deployment.md',
    pdfName: 'deployment.pdf',
    title: 'Azure Log Analytics KQL App - Deployment & Operations Guide'
  },
  {
    mdName: 'Architecture.md',
    pdfName: 'Architecture.pdf',
    title: 'Azure Log Analytics KQL App - Architecture Documentation'
  }
];

async function convertMdToPdf(browser, doc) {
  const mdPath = path.join(rootDir, doc.mdName);
  const pdfPath = path.join(rootDir, doc.pdfName);

  console.log(`\n--- Converting ${doc.mdName} -> ${doc.pdfName} ---`);
  if (!fs.existsSync(mdPath)) {
    console.warn(`File not found: ${mdPath}`);
    return;
  }

  const mdContent = fs.readFileSync(mdPath, 'utf8');
  const rawHtmlBody = marked(mdContent);

  // Convert <pre><code class="language-mermaid">...</code></pre> into <div class="mermaid">...</div>
  const processedHtmlBody = rawHtmlBody.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi, (match, code) => {
    const unescaped = code
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    return `<div class="mermaid">${unescaped}</div>`;
  });

  const fullHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${doc.title}</title>
      <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        body {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          line-height: 1.6;
          color: #1e293b;
          padding: 40px;
          margin: 0;
          font-size: 13px;
        }
        h1 {
          font-size: 24px;
          font-weight: 800;
          color: #0f172a;
          border-bottom: 2px solid #0078d4;
          padding-bottom: 10px;
          margin-top: 0;
        }
        h2 {
          font-size: 18px;
          font-weight: 700;
          color: #0078d4;
          margin-top: 28px;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 6px;
          page-break-before: always;
          break-before: page;
        }
        h2:first-of-type {
          page-break-before: auto;
          break-before: auto;
        }
        h3 {
          font-size: 15px;
          font-weight: 600;
          color: #334155;
          margin-top: 20px;
        }
        h4 {
          font-size: 13px;
          font-weight: 600;
          color: #475569;
          margin-top: 14px;
        }
        p, li {
          color: #334155;
        }
        code {
          font-family: 'JetBrains Mono', Consolas, monospace;
          background-color: #f1f5f9;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 12px;
          color: #0284c7;
        }
        pre {
          background-color: #0f172a;
          color: #f8fafc;
          padding: 16px;
          border-radius: 8px;
          overflow-x: auto;
        }
        pre code {
          background: none;
          color: inherit;
          padding: 0;
        }
        .mermaid {
          display: flex;
          justify-content: center;
          align-items: center;
          margin: 24px 0;
          background: #f8fafc;
          padding: 20px;
          border-radius: 8px;
          border: 1px solid #cbd5e1;
        }
        .mermaid svg {
          max-width: 100% !important;
          height: auto !important;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          font-size: 12px;
        }
        th, td {
          border: 1px solid #cbd5e1;
          padding: 10px 12px;
          text-align: left;
        }
        th {
          background-color: #f8fafc;
          font-weight: 700;
          color: #0f172a;
        }
        tr:nth-child(even) {
          background-color: #f1f5f9;
        }
        blockquote {
          border-left: 4px solid #0078d4;
          background: #eff6ff;
          margin: 16px 0;
          padding: 12px 16px;
          color: #1e3a8a;
          border-radius: 0 8px 8px 0;
        }
        hr {
          border: none;
          border-top: 1px solid #e2e8f0;
          margin: 30px 0;
        }
      </style>
    </head>
    <body>
      ${processedHtmlBody}
      <script>
        document.addEventListener("DOMContentLoaded", function() {
          mermaid.initialize({
            startOnLoad: true,
            theme: 'default',
            securityLevel: 'loose'
          });
        });
      </script>
    </body>
    </html>
  `;

  const page = await browser.newPage();
  await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

  // Wait for mermaid SVGs to render completely
  try {
    await page.waitForSelector('.mermaid svg', { timeout: 15000 });
    // Additional short delay for full SVG layout calculations
    await new Promise(r => setTimeout(r, 1000));
  } catch (e) {
    console.warn('Notice: timeout or no mermaid diagrams found on page.');
  }

  console.log(`Writing PDF to: ${pdfPath}`);
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    margin: {
      top: '20mm',
      right: '15mm',
      bottom: '20mm',
      left: '15mm'
    },
    printBackground: true
  });
  await page.close();
  console.log(`Successfully generated ${doc.pdfName}!`);
}

async function main() {
  const possiblePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser'
  ];

  let executablePath = possiblePaths.find(p => fs.existsSync(p));
  if (!executablePath) {
    throw new Error('No Chrome or Edge browser executable found on system.');
  }

  console.log(`Launching browser from: ${executablePath}`);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (const doc of docsToConvert) {
    await convertMdToPdf(browser, doc);
  }

  await browser.close();
  console.log('\nAll PDF conversions finished successfully!');
}

main().catch((err) => {
  console.error('Failed to generate PDFs:', err);
  process.exit(1);
});
