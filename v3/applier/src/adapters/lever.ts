import type { Page } from 'playwright';
import type { Job, ApplyResult, ApplyOptions, AtsAdapter } from '../types.js';
import { getFact, splitName } from '../personal.js';
import { matchFact, type MatchContext } from '../fields.js';
import { askAboutJob } from '../discord.js';
import { writeAnswer } from '../writer.js';
import type { Question } from '../questions.js';
import {
  uploadResume, submittedAndConfirmed, selectByText, emptyRequiredFields, optionsForQuestion, readFilledValues,
  valueForField, type FormField,
} from './common.js';
import { basename } from 'node:path';

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

type Field = FormField;

async function discoverFields(page: Page): Promise<Field[]> {
  return page.evaluate(() => {
    const fields: Array<{ selector: string; label: string; type: string; required: boolean }> = [];

    const form =
      document.querySelector('.application-form') ??
      document.querySelector('form[action*="apply"]') ??
      document.querySelector('form');
    if (!form) return fields;

    const inputs = form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), textarea, select',
    );

    inputs.forEach((input) => {
      const el = input as HTMLInputElement;
      const id = el.id || el.name || '';
      if (!id) return;

      let label = '';
      const labelEl = form.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (labelEl) {
        label = labelEl.textContent?.trim() ?? '';
      } else {
        const parent = el.closest('.application-question, .field, .form-group');
        if (parent) {
          const lbl = parent.querySelector('label') ?? parent.querySelector('.application-label');
          label = lbl?.textContent?.trim() ?? '';
        }
      }
      if (!label) label = el.placeholder || el.name || id;

      const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';

      fields.push({
        selector: el.id ? `#${CSS.escape(el.id)}` : `[name="${CSS.escape(el.name)}"]`,
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

/** Fill one field. Returns a blocker reason when a required field can't be answered. */
async function fillField(
  page: Page,
  field: Field,
  facts: Map<string, string>,
  ctx: MatchContext,
): Promise<{ filled: boolean; blocked?: string; openEnded?: boolean }> {
  const factKey = matchFact(field.label, field.type, ctx);
  const block = (reason: string) => (field.required ? { filled: false, blocked: reason } : { filled: false });

  if (!factKey) {
    if (field.type === 'textarea') return { filled: false, openEnded: true };
    return block(`Required field "${field.label}" — no mapping found`);
  }

  if (factKey === '__checkbox_confirm') {
    // Only consent the form requires; optional consent is Vinoth's to give.
    if (!field.required) return { filled: false };
    const ok = field.type === 'select'
      ? await selectByText(page, field.selector, ['Yes', 'I confirm', 'I agree', 'I acknowledge', 'Confirm', 'Agree'])
      : await page.check(field.selector).then(() => true, () => false);
    return ok ? { filled: true } : block(`Required consent "${field.label}" could not be confirmed`);
  }
  if (factKey === '__ask') return block(`Required field "${field.label}" needs a human answer`);
  if (factKey === '__empty_optional') return { filled: false };
  if (field.type === 'checkbox' || field.type === 'radio') {
    return block(`Required ${field.type} "${field.label}" needs a human answer`);
  }

  const fact = facts.get(factKey);
  const value = fact ? valueForField(field.label, fact) : fact;
  if (!value) return block(`Required field "${field.label}" needs "${factKey}" — missing or unapproved`);

  if (field.type === 'select') {
    if (await selectByText(page, field.selector, [value])) return { filled: true };
    return block(`Required select "${field.label}" — no option matching "${value}"`);
  }

  await page.click(field.selector);
  await page.fill(field.selector, value);
  return { filled: true };
}

/** Put a human's Discord answer into the field. True if it went in. */
async function fillAnswer(page: Page, field: Field, answer: string): Promise<boolean> {
  if (field.type === 'select') return selectByText(page, field.selector, [answer]);
  if (field.type === 'checkbox' || field.type === 'radio') return false;
  await page.fill(field.selector, answer);
  return true;
}

export const lever: AtsAdapter = {
  name: 'lever',

  async apply(job: Job, opts: ApplyOptions): Promise<ApplyResult> {
    const screenshots: string[] = [];
    const browser = opts.browser;
    const page = await browser.newPage();
    let submitted = false;

    try {
      let applyUrl = job['Apply Link'];
      if (!applyUrl.endsWith('/apply')) {
        applyUrl = applyUrl.replace(/\/$/, '') + '/apply';
      }

      // The posting page carries the description; the /apply page is mostly the form.
      await page.goto(applyUrl.replace(/\/apply$/, ''), { waitUntil: 'domcontentloaded', timeout: 30000 });
      const posting = await page.innerText('body').catch(() => '');

      console.log(`  🏗️  Lever: navigating to ${applyUrl}`);
      await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const facts = new Map(opts.personalFacts);
      const fullName = getFact(facts, 'full_name');
      if (fullName) {
        const { first, last } = splitName(fullName);
        facts.set('__first_name', first);
        facts.set('__last_name', last);
      }
      const ctx: MatchContext = { jobLocation: job['Location'] ?? '' };

      const fields = await discoverFields(page);
      console.log(`  → Found ${fields.length} form fields`);

      const blockers: Omit<Question, 'n'>[] = [];
      let filled = 0;

      for (const field of fields) {
        const result = await fillField(page, field, facts, ctx);
        if (result.filled) {
          filled++;
          console.log(`    ✅ ${field.label}`);
          continue;
        }

        if (result.openEnded) {
          try {
            let text = opts.answers.generatedAnswer(job['Job ID'], field.label);
            if (!text) {
              console.log(`    ✍️  Writing an answer for "${field.label}"...`);
              text = await writeAnswer({
                question: field.label, company: job['Company Name'], role: job['Role'], posting, facts,
              });
              opts.answers.saveGenerated(job['Job ID'], field.label, text);
              opts.answers.save();
            }
            await page.fill(field.selector, text);
            filled++;
            console.log(`    ✅ ${field.label} (written — review it in the fill report)`);
          } catch (err) {
            const reason = `Could not write an answer for "${field.label}": ${err instanceof Error ? err.message.slice(0, 120) : err}`;
            if (field.required) blockers.push({ label: field.label, reason });
            console.log(`    ${field.required ? '❌' : '⏭️ '} ${field.label}: ${reason}`);
          }
          continue;
        }
        if (!result.blocked) {
          console.log(`    ⏭️  ${field.label} (skipped — optional, no mapping)`);
          continue;
        }

        let reason = result.blocked;
        const saved = opts.answers.lookup(job['Job ID'], field.label);
        if (saved) {
          if (await fillAnswer(page, field, saved)) {
            filled++;
            console.log(`    ✅ ${field.label} (your Discord answer: "${saved}")`);
            continue;
          }
          opts.answers.forget(job['Job ID'], field.label);
          reason = `Your answer "${saved}" matched nothing on the form`;
        }
        blockers.push({ label: field.label, reason, ...(await optionsForQuestion(page, field)) });
        console.log(`    ❌ ${field.label}: ${reason}`);
      }

      const resume = await uploadResume(page, opts.resumePath);
      if (resume === 'attached') {
        filled++;
      } else {
        const reason = resume === 'no-input'
          ? 'No resume upload field found on the form'
          : 'Resume upload did not finish — the form never showed the file as attached';
        blockers.push({ label: 'Resume/CV', reason });
        console.log(`    ❌ Resume/CV: ${reason}`);
      }

      const alreadyBlocked = new Set(blockers.map((b) => b.label));
      for (const label of await emptyRequiredFields(page, fields)) {
        if (alreadyBlocked.has(label)) continue;
        const saved = opts.answers.lookup(job['Job ID'], label);
        if (saved) opts.answers.forget(job['Job ID'], label);
        const reason = saved
          ? `Your answer "${saved}" didn't stick — the field is still empty`
          : `Required field "${label}" is still empty after filling`;
        const field = fields.find((f) => f.label === label)!;
        blockers.push({ label, reason, ...(await optionsForQuestion(page, field)) });
        console.log(`    ❌ ${label}: ${reason}`);
      }
      console.log(`  → Filled ${filled} fields`);

      screenshots.push(await browser.screenshot(page, job['Job ID'], 'after-fill'));
      await browser.saveFillRecord(page, {
        jobId: job['Job ID'], company: job['Company Name'], role: job['Role'], applyLink: job['Apply Link'],
        status: blockers.length ? 'Blocked' : opts.submit ? 'Submitting' : 'Dry run — ready to submit',
        notes: blockers.map((b) => b.reason).join('; '),
        values: [
          ...(await readFilledValues(page, fields)),
          { label: 'Resume/CV', type: 'file', required: true, value: resume === 'attached' ? basename(opts.resumePath) : '' },
        ],
      }, ['.application-form', 'form[action*="apply"]', 'form']);

      if (blockers.length > 0) {
        await askAboutJob(opts.answers, job, blockers);
        return { status: 'Blocked', notes: blockers.map((b) => b.reason).join('; '), screenshots, submitted };
      }

      if (!opts.submit) {
        console.log('  🏁 Dry-run: form filled but NOT submitted');
        return { status: 'Blocked', notes: 'DRY RUN — form filled successfully, not submitted', screenshots, submitted };
      }

      console.log('  🚀 Submitting application...');
      const submitBtn = await page.$(
        'button[type="submit"], button:has-text("Submit application"), input[type="submit"]',
      );
      if (!submitBtn) {
        return { status: 'Failed', notes: 'Could not find submit button', screenshots, submitted };
      }

      const formUrl = page.url();
      await submitBtn.click();
      submitted = true;
      await page.waitForTimeout(5000);
      screenshots.push(await browser.screenshot(page, job['Job ID'], 'after-submit'));

      if (await submittedAndConfirmed(page, formUrl, '.application-form, form[action*="apply"]')) {
        console.log('  ✅ Confirmation detected');
        return { status: 'Applied', notes: 'Submitted via Lever, confirmation seen', screenshots, submitted };
      }

      return {
        status: 'Blocked',
        notes: 'SUBMIT CLICKED, NO CONFIRMATION — check the acknowledgement email before re-applying. ' +
          'Possibly a validation error; see the after-submit screenshot.',
        screenshots,
        submitted,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  💥 Lever error: ${msg}`);
      try {
        screenshots.push(await browser.screenshot(page, job['Job ID'], 'error'));
      } catch { /* ignore */ }
      return { status: 'Failed', notes: `Lever adapter error: ${msg}`, screenshots, submitted };
    } finally {
      await page.close();
    }
  },
};
