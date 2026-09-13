import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Manages a persistent Playwright browser context.
 *
 * Why persistent? Sessions survive across runs. Sign into LinkedIn, Workday,
 * etc. once by hand and the applier reuses the cookies. This is the only
 * login method that works — scripted Google sign-in lands on /signin/rejected
 * and burns the session (v1 §5).
 *
 * Viewport 1280×1600: tall to see full application forms without scrolling,
 * matching the v1 recipe.
 */
export class Browser {
  private ctx: BrowserContext | null = null;
  private screenshotDir: string;

  constructor(
    private profileDir: string,
    private headed: boolean,
    screenshotDir?: string,
  ) {
    this.screenshotDir =
      screenshotDir ?? resolve(__dirname, '..', 'screenshots');
    mkdirSync(this.screenshotDir, { recursive: true });
    mkdirSync(this.profileDir, { recursive: true });
  }

  async launch(): Promise<BrowserContext> {
    if (this.ctx) return this.ctx;
    this.ctx = await chromium.launchPersistentContext(this.profileDir, {
      headless: !this.headed,
      viewport: { width: 1280, height: 1600 },
      locale: 'en-US',
      timezoneId: 'Asia/Kolkata',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      args: ['--disable-blink-features=AutomationControlled'],
    });
    return this.ctx;
  }

  /** Open a new page (tab). Close it after the adapter finishes. */
  async newPage(): Promise<Page> {
    const ctx = await this.launch();
    return ctx.newPage();
  }

  /**
   * Take a screenshot and save it with a descriptive filename.
   * Returns the absolute path to the saved file.
   */
  async screenshot(page: Page, jobId: string, label: string): Promise<string> {
    const safe = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${safe}_${label}_${ts}.png`;
    const filepath = resolve(this.screenshotDir, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`  📸 ${label}: ${filepath}`);
    return filepath;
  }

  async close(): Promise<void> {
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }
}
