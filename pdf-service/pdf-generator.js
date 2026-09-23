#!/usr/bin/env node

const puppeteer = require('puppeteer');
const fs = require('fs');

async function generatePdf(htmlContent, outputPath) {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath:
            process.env.PUPPETEER_EXECUTABLE_PATH ||
            await puppeteer.executablePath(),

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

        // Wait for fonts
        await page.evaluateHandle('document.fonts.ready');

        // Optional: wait for QR code / canvas
        try {
            await page.waitForSelector('canvas', {
                timeout: 5000,
            });
        } catch (error) {
            // Canvas may not exist on every document
        }

        // Small delay to allow JS-rendered elements to finish
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
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
