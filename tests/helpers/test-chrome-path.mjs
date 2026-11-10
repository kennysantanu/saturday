// Executed by the test-only Chrome wrapper, inside the inherited macOS sandbox.
import puppeteer from 'puppeteer';
process.stdout.write(await puppeteer.executablePath());
