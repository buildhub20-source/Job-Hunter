import type { Page } from 'playwright';
import type { Job, ApplyResult, ApplyOptions, AtsAdapter } from '../types.js';
import { getFact, splitName } from '../personal.js';
import { Browser } from '../browser.js';

/**
 * Greenhouse form filler.
 *
 * Greenhouse is the simplest ATS — no account required, public application form.
 * The form lives at the same URL as the job posting (with an "Apply" button) or
 * at a dedicated /apply path. Fields are standard HTML inputs with id/name attrs.
 *
 * Greenhouse form structure (typical):
 * - First name, Last name (required)
 * - Email (required)
 * - Phone
 * - Resume/CV upload (required)
 * - LinkedIn profile URL
 * - Cover letter (usually optional)
 * - Custom questions (varies per employer)
 *
 * Ground rule: NEVER invent a value. If a required field can't be filled from
 * personal.md, park the job as Blocked.
 */

/** Maps of Greenhouse field patterns → personal.md keys. */
const FIELD_MAP: Array<{
  pattern: RegExp;
  factKey: string;
  transform?: (v: string) => string;
}> = [
  { pattern: /first.?name/i, factKey: '__first_name' },
  { pattern: /last.?name/i, factKey: '__last_name' },
  { pattern: /email/i, factKey: 'primary_email' },
  { pattern: /phone|mobile/i, factKey: 'phone' },
  { pattern: /linkedin/i, factKey: 'linkedin_url' },
  { pattern: /github/i, factKey: 'github_url' },
  { pattern: /portfolio|website|personal.?site/i, factKey: 'portfolio_url' },
  { pattern: /(?:current|most.?recent|recent|previous).?(?:company|employer|organization|org)/i, factKey: 'current_employer' },
  { pattern: /(?:current|most.?recent|recent).?(?:title|role|job.?title)|job.?title/i, factKey: 'current_title' },
  { pattern: /confirm|privacy|consent|truth|accuracy|notice|terms/i, factKey: '__checkbox_confirm' },
  { pattern: /where.?are.?you.?located|city|location/i, factKey: 'current_city' },
  { pattern: /country.?of.?residence|current.?country|country/i, factKey: 'current_country' },
  { pattern: /salary|compensation|ctc|current.?ctc/i, factKey: 'current_ctc' },
  { pattern: /expected.?salary|expected.?ctc|expected.?comp|salary.?expect/i, factKey: 'expected_ctc' },
  { pattern: /notice.?period/i, factKey: 'notice_period_days' },
  { pattern: /experience|years.?of.?experience|total.?exp/i, factKey: 'total_experience_years' },
  { pattern: /university|college|school/i, factKey: 'university' },
  { pattern: /degree|qualification/i, factKey: 'highest_qualification' },
  { pattern: /discipline|major|field.?of.?study|branch|specialization/i, factKey: 'degree_branch' },
  { pattern: /gpa|cgpa|percentage/i, factKey: 'cgpa_or_percentage' },
  { pattern: /willing.?to.?relocate|relocation/i, factKey: 'willing_to_relocate' },
  { pattern: /legally.?auth|authorized.?to.?work|work.?auth|right.?to.?work/i, factKey: 'authorized_to_work_india' },
  { pattern: /sponsorship|visa.?sponsor|require.?.*?sponsor|immigration.?sponsor/i, factKey: 'requires_sponsorship_india' },
  { pattern: /subject.?to.?.*?(?:agreement|restriction)|non.?compete|post.?employ/i, factKey: '__no' },
  { pattern: /previously.?worked|worked.?(?:at|for)|consulted.?(?:at|for)/i, factKey: '__no' },
  { pattern: /preferred.?(?:first.?)?name|nickname/i, factKey: 'preferred_name' },
  { pattern: /end.?date.?year|graduation.?year|year.?of.?graduation/i, factKey: 'graduation_year' },
  { pattern: /start.?date.?year|education.?start/i, factKey: 'education_start' },
  { pattern: /start.?date|earliest.?start|availability|preferred.?start/i, factKey: 'earliest_start_date' },
  { pattern: /comfortable|are.?you.?(?:ok|okay|open|willing|happy|fine)/i, factKey: '__yes' },
  { pattern: /accessible|accommodation|adjustment|assist/i, factKey: '__empty_optional' },
  { pattern: /leetcode/i, factKey: 'leetcode_url' },
];

async function fillTextField(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  // Dismiss any lingering React Select dropdown overlay before clicking
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(100);

  await page.click(selector, { timeout: 10000 }).catch(async () => {
    // If click is intercepted by an overlay, try force-clicking
    await page.locator(selector).click({ force: true });
  });
  await page.fill(selector, '');
  await page.fill(selector, value);

  // Dismiss dropdown that may have opened (React Select, Select2, etc.)
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(100);
}

/**
 * Attempt to fill a single form field. Returns true if filled, false if
 * the field wasn't recognized or the needed fact is missing.
 */
async function tryFillField(
  page: Page,
  el: { selector: string; label: string; type: string; required: boolean },
  facts: Map<string, string>,
): Promise<{ filled: boolean; blocked?: string }> {
  const label = el.label.toLowerCase();

  for (const { pattern, factKey, transform } of FIELD_MAP) {
    if (!pattern.test(label)) continue;

    if (factKey === '__checkbox_confirm') {
      try {
        await page.check(el.selector);
        return { filled: true };
      } catch {
        try {
          await page.click(el.selector);
          return { filled: true };
        } catch {
          if (el.required) {
            return { filled: false, blocked: `Failed to check required consent checkbox "${el.label}"` };
          }
          return { filled: false };
        }
      }
    }

    // Synthetic: answer "No" to yes/no questions (e.g. "previously worked at X?")
    if (factKey === '__no') {
      if (el.type === 'select') {
        try {
          await page.selectOption(el.selector, { label: 'No' });
          return { filled: true };
        } catch {
          // Try value-based
          try { await page.selectOption(el.selector, 'No'); return { filled: true }; } catch { /* fall through */ }
        }
      }
      await fillTextField(page, el.selector, 'No');
      return { filled: true };
    }

    // Synthetic: answer "Yes" to comfort/willingness questions
    if (factKey === '__yes') {
      if (el.type === 'select') {
        try {
          await page.selectOption(el.selector, { label: 'Yes' });
          return { filled: true };
        } catch {
          try { await page.selectOption(el.selector, 'Yes'); return { filled: true }; } catch { /* fall through */ }
        }
      }
      await fillTextField(page, el.selector, 'Yes');
      return { filled: true };
    }

    // Synthetic: skip optional fields gracefully (e.g. accessibility accommodations)
    if (factKey === '__empty_optional') {
      return { filled: false };
    }

    const value = facts.get(factKey);
    if (!value) {
      if (el.required) {
        return {
          filled: false,
          blocked: `Required field "${el.label}" needs fact "${factKey}" which is missing or unapproved`,
        };
      }
      return { filled: false };
    }

    const finalValue = transform ? transform(value) : value;

    if (el.type === 'select') {
      // Try to find a matching option
      try {
        await page.selectOption(el.selector, { label: finalValue });
        return { filled: true };
      } catch {
        // Try partial match
        const options = await page.$$eval(
          `${el.selector} option`,
          (opts) => opts.map((o) => ({ value: o.getAttribute('value') ?? '', text: o.textContent ?? '' })),
        );
        const match = options.find(
          (o) => o.text.toLowerCase().includes(finalValue.toLowerCase()),
        );
        if (match) {
          await page.selectOption(el.selector, match.value);
          return { filled: true };
        }
        if (el.required) {
          return { filled: false, blocked: `Required select "${el.label}" has no option matching "${finalValue}"` };
        }
        return { filled: false };
      }
    }

    if (el.type === 'textarea') {
      await fillTextField(page, el.selector, finalValue);
      return { filled: true };
    }

    // Number inputs: only fill if the value is actually numeric
    if (el.type === 'number') {
      const numeric = finalValue.replace(/[^0-9.]/g, '');
      if (!numeric) {
        // Can't type text into a number field — skip gracefully
        console.log(`    ⏭️  ${el.label} (skipped — value "${finalValue}" is not numeric)`);
        return { filled: false };
      }
      await fillTextField(page, el.selector, numeric);
      return { filled: true };
    }

    // React Select combobox: type value, wait for dropdown, press Enter
    if (el.type === 'combobox') {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(100);
      await page.locator(el.selector).click({ force: true });
      await page.waitForTimeout(200);
      // Clear and type the value to trigger autocomplete
      await page.locator(el.selector).fill('');
      await page.locator(el.selector).pressSequentially(finalValue, { delay: 50 });
      await page.waitForTimeout(500);
      // Select the first matching option
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      // Dismiss any remaining overlay
      await page.keyboard.press('Escape').catch(() => {});
      return { filled: true };
    }

    // Default: text input
    await fillTextField(page, el.selector, finalValue);
    return { filled: true };
  }

  // No pattern matched this field
  if (el.required) {
    // Check for common non-factual required fields
    if (/how.?did.?you.?(hear|find|learn)/i.test(label)) {
      return {
        filled: false,
        blocked: `Required field "${el.label}" — "how did you hear" is UNKNOWN`,
      };
    }
    return {
      filled: false,
      blocked: `Required field "${el.label}" — no mapping found`,
    };
  }

  return { filled: false };
}

/**
 * Discover form fields on a Greenhouse application page.
 * Returns a list of { selector, label, type, required } objects.
 */
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

    // Find all input, textarea, and select elements inside the application form
    const form =
      document.querySelector('#application_form') ??
      document.querySelector('form[action*="application"]') ??
      document.querySelector('form');
    if (!form) return fields;

    const inputs = form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select',
    );

    inputs.forEach((input) => {
      const el = input as HTMLInputElement;
      const id = el.id || el.name || '';
      if (!id) return;

      // Find the associated label
      let label = '';
      const labelEl = form.querySelector(`label[for="${id}"]`);
      if (labelEl) {
        label = labelEl.textContent?.trim() ?? '';
      } else {
        // Walk up to find a parent label or sibling
        const parent = el.closest('.field, .form-group, .application-field');
        if (parent) {
          const lbl =
            parent.querySelector('label') ??
            parent.querySelector('.field__label');
          label = lbl?.textContent?.trim() ?? '';
        }
      }
      if (!label) label = el.placeholder || el.name || id;

      const required =
        el.hasAttribute('required') ||
        el.getAttribute('aria-required') === 'true' ||
        !!el.closest('.field')?.querySelector('.required');

      fields.push({
        selector: id ? `#${CSS.escape(id)}` : `[name="${el.name}"]`,
        label,
        type: el.tagName.toLowerCase() === 'select'
          ? 'select'
          : el.tagName.toLowerCase() === 'textarea'
            ? 'textarea'
            : el.getAttribute('role') === 'combobox'
              ? 'combobox'
              : el.type || 'text',
        required,
      });
    });

    return fields;
  });
}

export const greenhouse: AtsAdapter = {
  name: 'greenhouse',

  async apply(job: Job, opts: ApplyOptions): Promise<ApplyResult> {
    const screenshots: string[] = [];
    const browser = opts.browser;
    const page = await browser.newPage();

    try {
      console.log(`  🌱 Greenhouse: navigating to ${job['Apply Link']}`);
      await page.goto(job['Apply Link'], {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      // Some Greenhouse pages require clicking an "Apply" button first
      const applyBtn = await page.$(
        'a[href*="/apply"], button:has-text("Apply"), a:has-text("Apply for this job")',
      );
      if (applyBtn) {
        console.log('  → Clicking "Apply" button to open form');
        await applyBtn.click();
        await page.waitForTimeout(2000);
      }

      // Prepare name facts
      const fullName = getFact(opts.personalFacts, 'full_name');
      if (!fullName) {
        return {
          status: 'Blocked',
          notes: 'full_name is missing from personal.md',
          screenshots,
        };
      }
      const { first, last } = splitName(fullName);
      const facts = new Map(opts.personalFacts);
      facts.set('__first_name', first);
      facts.set('__last_name', last);

      // Screenshot before filling
      screenshots.push(
        await browser.screenshot(page, job['Job ID'], 'before-fill'),
      );

      // Discover and fill fields
      const fields = await discoverFields(page);
      console.log(`  → Found ${fields.length} form fields`);

      const blockers: string[] = [];
      let filled = 0;

      for (const field of fields) {
        const result = await tryFillField(page, field, facts);
        if (result.filled) {
          filled++;
          console.log(`    ✅ ${field.label}`);
        } else if (result.blocked) {
          blockers.push(result.blocked);
          console.log(`    ❌ ${field.label}: ${result.blocked}`);
        } else {
          console.log(`    ⏭️  ${field.label} (skipped — optional, no mapping)`);
        }
      }

      // Upload resume
      const fileInput = await page.$(
        'input[type="file"][name*="resume"], input[type="file"][id*="resume"], ' +
        'input[type="file"][name*="cv"], input[type="file"]',
      );
      if (fileInput) {
        console.log(`  📎 Uploading resume: ${opts.resumePath}`);
        await fileInput.setInputFiles(opts.resumePath);
        filled++;
      }

      console.log(`  → Filled ${filled} fields`);

      // Screenshot after filling
      screenshots.push(
        await browser.screenshot(page, job['Job ID'], 'after-fill'),
      );

      // Check for blockers
      if (blockers.length > 0) {
        return {
          status: 'Blocked',
          notes: blockers.join('; '),
          screenshots,
        };
      }

      // Dry-run: stop here
      if (!opts.submit) {
        console.log('  🏁 Dry-run: form filled but NOT submitted');
        return {
          status: 'Blocked',
          notes: 'DRY RUN — form filled successfully, not submitted',
          screenshots,
        };
      }

      // Submit
      console.log('  🚀 Submitting application...');
      const submitBtn = await page.$(
        'button[type="submit"], input[type="submit"], button:has-text("Submit")',
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

      // Screenshot the result page
      screenshots.push(
        await browser.screenshot(page, job['Job ID'], 'after-submit'),
      );

      // Check for confirmation
      const bodyText = await page.textContent('body');
      const confirmed =
        bodyText &&
        (/thank\s*you/i.test(bodyText) ||
          /application.*received/i.test(bodyText) ||
          /successfully\s*submitted/i.test(bodyText) ||
          /application.*submitted/i.test(bodyText));

      if (confirmed) {
        console.log('  ✅ Confirmation page detected');
        return {
          status: 'Applied',
          notes: 'Submitted via Greenhouse, confirmation page seen',
          screenshots,
        };
      }

      // No clear confirmation — mark as unverified
      // v3 design: "Never trust the page about whether you submitted"
      return {
        status: 'Applied',
        notes:
          'Submitted via Greenhouse — no clear confirmation text detected. ' +
          'Verify from acknowledgement email before trusting this status.',
        screenshots,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  💥 Greenhouse error: ${msg}`);

      try {
        screenshots.push(
          await browser.screenshot(page, job['Job ID'], 'error'),
        );
      } catch { /* ignore screenshot failure */ }

      return {
        status: 'Failed',
        notes: `Greenhouse adapter error: ${msg}`,
        screenshots,
      };
    } finally {
      await page.close();
    }
  },
};
