import type { Page } from 'playwright';
import type { Job, ApplyResult, ApplyOptions, AtsAdapter } from '../types.js';
import { getFact, splitName } from '../personal.js';
import { Browser } from '../browser.js';

/**
 * Lever form filler.
 *
 * Lever is similar to Greenhouse — public form, no login required.
 * Apply URL is jobs.lever.co/<company>/<uuid>/apply or the posting page
 * has an "Apply for this job" link.
 *
 * Lever form structure (typical):
 * - Full name (single field, not split)
 * - Email
 * - Phone
 * - Current company
 * - LinkedIn, GitHub, Portfolio URLs
 * - Resume upload
 * - Additional information (textarea)
 * - Custom questions per employer
 */

const FIELD_MAP: Array<{ pattern: RegExp; factKey: string }> = [
  { pattern: /full.?name|your.?name|^name$/i, factKey: 'full_name' },
  { pattern: /email/i, factKey: 'primary_email' },
  { pattern: /phone|mobile/i, factKey: 'phone' },
  { pattern: /linkedin/i, factKey: 'linkedin_url' },
  { pattern: /github/i, factKey: 'github_url' },
  { pattern: /portfolio|website|personal.?url/i, factKey: 'portfolio_url' },
  { pattern: /(?:current|most.?recent|recent|previous).?(?:company|employer|organization|org)|org/i, factKey: 'current_employer' },
  { pattern: /(?:current|most.?recent|recent).?(?:title|role|job.?title)|job.?title/i, factKey: 'current_title' },
  { pattern: /confirm|privacy|consent|truth|accuracy|notice|terms/i, factKey: '__checkbox_confirm' },
  { pattern: /location|city/i, factKey: 'current_city' },
  { pattern: /salary|compensation|ctc/i, factKey: 'current_ctc' },
  { pattern: /expected.?salary|expected.?ctc/i, factKey: 'expected_ctc' },
  { pattern: /notice.?period/i, factKey: 'notice_period_days' },
  { pattern: /experience|years.?of/i, factKey: 'total_experience_years' },
  { pattern: /university|college|school/i, factKey: 'university' },
  { pattern: /degree/i, factKey: 'highest_qualification' },
  { pattern: /gpa|cgpa/i, factKey: 'cgpa_or_percentage' },
  { pattern: /relocat/i, factKey: 'willing_to_relocate' },
  { pattern: /sponsorship|visa|work.?auth/i, factKey: 'requires_sponsorship_india' },
  { pattern: /start.?date|earliest.?start|availability/i, factKey: 'earliest_start_date' },
  { pattern: /country/i, factKey: 'current_country' },
];

async function discoverFields(page: Page): Promise<
  Array<{ selector: string; label: string; type: string; required: boolean }>
> {
  return page.evaluate(() => {
    const fields: Array<{
      selector: string;
      label: string;
      type: string;
      required: boolean;
    }> = [];

    // Lever uses .application-form or the main form
    const form =
      document.querySelector('.application-form') ??
      document.querySelector('form[action*="apply"]') ??
      document.querySelector('form');
    if (!form) return fields;

    const inputs = form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select',
    );

    inputs.forEach((input) => {
      const el = input as HTMLInputElement;
      const id = el.id || el.name || '';
      if (!id) return;

      let label = '';
      // Lever uses .application-label or standard labels
      const labelEl = form.querySelector(`label[for="${id}"]`);
      if (labelEl) {
        label = labelEl.textContent?.trim() ?? '';
      } else {
        const parent = el.closest(
          '.application-question, .field, .form-group',
        );
        if (parent) {
          const lbl =
            parent.querySelector('label') ??
            parent.querySelector('.application-label');
          label = lbl?.textContent?.trim() ?? '';
        }
      }
      if (!label) label = el.placeholder || el.name || id;

      const required =
        el.hasAttribute('required') ||
        el.getAttribute('aria-required') === 'true';

      fields.push({
        selector: id ? `#${CSS.escape(id)}` : `[name="${el.name}"]`,
        label,
        type:
          el.tagName.toLowerCase() === 'select'
            ? 'select'
            : el.tagName.toLowerCase() === 'textarea'
              ? 'textarea'
              : el.type || 'text',
        required,
      });
    });

    return fields;
  });
}

export const lever: AtsAdapter = {
  name: 'lever',

  async apply(job: Job, opts: ApplyOptions): Promise<ApplyResult> {
    const screenshots: string[] = [];
    const browser = opts.browser;
    const page = await browser.newPage();

    try {
      // Lever apply URL: append /apply if not already there
      let applyUrl = job['Apply Link'];
      if (!applyUrl.endsWith('/apply')) {
        applyUrl = applyUrl.replace(/\/$/, '') + '/apply';
      }

      console.log(`  🏗️  Lever: navigating to ${applyUrl}`);
      await page.goto(applyUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      screenshots.push(
        await browser.screenshot(page, job['Job ID'], 'before-fill'),
      );

      const fields = await discoverFields(page);
      console.log(`  → Found ${fields.length} form fields`);

      const blockers: string[] = [];
      let filled = 0;

      for (const field of fields) {
        const label = field.label.toLowerCase();
        let matched = false;

        for (const { pattern, factKey } of FIELD_MAP) {
          if (!pattern.test(label)) continue;

          if (factKey === '__checkbox_confirm') {
            try {
              await page.check(field.selector);
              filled++;
              console.log(`    ✅ ${field.label} (confirmed)`);
            } catch {
              try {
                await page.click(field.selector);
                filled++;
                console.log(`    ✅ ${field.label} (clicked)`);
              } catch {
                if (field.required) {
                  blockers.push(`Required consent "${field.label}" could not be checked`);
                  console.log(`    ❌ ${field.label}: consent click failed`);
                }
              }
            }
            matched = true;
            break;
          }

          const value = opts.personalFacts.get(factKey);
          if (!value) {
            if (field.required) {
              blockers.push(
                `Required field "${field.label}" needs "${factKey}" — missing or unapproved`,
              );
              console.log(`    ❌ ${field.label}: missing ${factKey}`);
            }
            matched = true;
            break;
          }

          if (field.type === 'select') {
            try {
              await page.selectOption(field.selector, { label: value });
              filled++;
              console.log(`    ✅ ${field.label}`);
            } catch {
              if (field.required) {
                blockers.push(
                  `Required select "${field.label}" — no option matching "${value}"`,
                );
                console.log(`    ❌ ${field.label}: no matching option`);
              }
            }
          } else {
            await page.click(field.selector);
            await page.fill(field.selector, value);
            filled++;
            console.log(`    ✅ ${field.label}`);
          }
          matched = true;
          break;
        }

        if (!matched) {
          if (field.required && /how.?did.?you/i.test(field.label)) {
            blockers.push(
              `Required field "${field.label}" — "how did you hear" is UNKNOWN`,
            );
            console.log(`    ❌ ${field.label}: UNKNOWN`);
          } else if (field.required) {
            blockers.push(`Required field "${field.label}" — no mapping found`);
            console.log(`    ❌ ${field.label}: no mapping`);
          } else {
            console.log(
              `    ⏭️  ${field.label} (skipped — optional, no mapping)`,
            );
          }
        }
      }

      // Upload resume
      const fileInput = await page.$(
        'input[type="file"][name*="resume"], input[type="file"]',
      );
      if (fileInput) {
        console.log(`  📎 Uploading resume: ${opts.resumePath}`);
        await fileInput.setInputFiles(opts.resumePath);
        filled++;
      }

      console.log(`  → Filled ${filled} fields`);

      screenshots.push(
        await browser.screenshot(page, job['Job ID'], 'after-fill'),
      );

      if (blockers.length > 0) {
        return { status: 'Blocked', notes: blockers.join('; '), screenshots };
      }

      if (!opts.submit) {
        console.log('  🏁 Dry-run: form filled but NOT submitted');
        return {
          status: 'Blocked',
          notes: 'DRY RUN — form filled successfully, not submitted',
          screenshots,
        };
      }

      console.log('  🚀 Submitting application...');
      const submitBtn = await page.$(
        'button[type="submit"], button:has-text("Submit application"), ' +
        'button:has-text("Submit"), input[type="submit"]',
      );
      if (!submitBtn) {
        return {
          status: 'Failed',
          notes: 'Could not find submit button',
          screenshots,
        };
      }

      await submitBtn.click();
      await page.waitForTimeout(5000);

      screenshots.push(
        await browser.screenshot(page, job['Job ID'], 'after-submit'),
      );

      const bodyText = await page.textContent('body');
      const confirmed =
        bodyText &&
        (/thank\s*you/i.test(bodyText) ||
          /application.*received/i.test(bodyText) ||
          /successfully/i.test(bodyText));

      if (confirmed) {
        console.log('  ✅ Confirmation detected');
        return {
          status: 'Applied',
          notes: 'Submitted via Lever, confirmation seen',
          screenshots,
        };
      }

      return {
        status: 'Applied',
        notes:
          'Submitted via Lever — verify from acknowledgement email.',
        screenshots,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  💥 Lever error: ${msg}`);

      try {
        screenshots.push(
          await browser.screenshot(page, job['Job ID'], 'error'),
        );
      } catch { /* ignore */ }

      return {
        status: 'Failed',
        notes: `Lever adapter error: ${msg}`,
        screenshots,
      };
    } finally {
      await page.close();
    }
  },
};
