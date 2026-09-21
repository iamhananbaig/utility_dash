#!/usr/bin/env node

const puppeteer = require('puppeteer-core');
const fs = require('fs');

// Find Chrome binary
function findChrome() {
    const cacheDir = '/home/hanan/.cache/puppeteer/chrome';
    const entries = fs.readdirSync(cacheDir).filter(e => e.startsWith('linux-'));
    if (entries.length === 0) throw new Error('No Chrome found in puppeteer cache');
    // Sort by version, use latest
    entries.sort();
    const latest = entries[entries.length - 1];
    const chromePath = `${cacheDir}/${latest}/chrome-linux64/chrome`;
    if (!fs.existsSync(chromePath)) throw new Error(`Chrome binary not found at ${chromePath}`);
    return chromePath;
}

async function generatePdf(htmlContent, outputPath) {
    const chromePath = findChrome();

    const browser = await puppeteer.launch({
        headless: true,
        executablePath: chromePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ],
    });

    try {
        const page = await browser.newPage();

        await page.setContent(htmlContent, {
            waitUntil: 'networkidle0',
            timeout: 30000,
        });

        // Wait for QR canvas to render
        try {
            await page.waitForSelector('canvas', { timeout: 5000 });
        } catch {
            // No canvas, continue
        }

        // Additional wait for dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '10mm',
                right: '10mm',
                bottom: '10mm',
                left: '10mm',
            },
        });

        if (outputPath) {
            fs.writeFileSync(outputPath, pdfBuffer);
        } else {
            process.stdout.write(pdfBuffer);
        }
    } finally {
        await browser.close();
    }
}

async function main() {
    const args = process.argv.slice(2);
    let htmlContent = '';

    if (args.includes('--file')) {
        const fileIdx = args.indexOf('--file') + 1;
        htmlContent = fs.readFileSync(args[fileIdx], 'utf-8');
    } else {
        htmlContent = fs.readFileSync(0, 'utf-8');
    }

    const outputIdx = args.indexOf('--output');
    const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;

    await generatePdf(htmlContent, outputPath);
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
