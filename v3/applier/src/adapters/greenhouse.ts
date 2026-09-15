import type { Page } from 'playwright';
import type { Job, ApplyResult, ApplyOptions, AtsAdapter } from '../types.js';
import { getFact, splitName } from '../personal.js';
import { matchFact, type MatchContext } from '../fields.js';
import { askAboutJob } from '../discord.js';
import { writeAnswer, chooseOption } from '../writer.js';
import type { Question } from '../questions.js';
import {
  uploadResume, submittedAndConfirmed, selectByText, chooseComboboxOption, emptyRequiredFields,
  optionsForQuestion, readFilledValues, valueForField, type FormField,
} from './common.js';
import { basename } from 'node:path';

/**
 * Greenhouse form filler.
 *
 * Greenhouse is the simplest ATS — no account required, public application form.
 * The form lives at the same URL as the job posting (with an "Apply" button) or
 * at a dedicated /apply path. Fields are standard HTML inputs with id/name attrs.
 *
 * Ground rule: NEVER invent a value. If a required field can't be filled from
 * personal.md, park the job as Blocked.
 */

type Field = FormField;

const CONSENT_ANSWERS = ['Yes', 'I confirm', 'I agree', 'I acknowledge', 'Confirm', 'Agree', 'Acknowledge'];

async function fillTextField(page: Page, selector: string, value: string): Promise<void> {
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

type FillResult = {
  filled: boolean;
  blocked?: string;
  tried?: string;
  skipped?: string;
  openEnded?: boolean;
  openChoice?: boolean;
  /** A short text field no rule recognises — filled only as a follow-up to a choice. */
  unmatchedText?: boolean;
};

/** Same meaning, different words: a form may say "Man" where personal.md says "Male". */
const SYNONYMS: Record<string, string[]> = {
  male: ['Man'],
  female: ['Woman'],
};

/** What to try in a dropdown for a fact, in order. */
function optionCandidates(factKey: string, value: string, facts: Map<string, string>): string[] {
  if (factKey === 'current_city') return [value, facts.get('current_country') ?? ''];
  return [value, ...(SYNONYMS[value.toLowerCase()] ?? [])];
}

/**
 * Attempt to fill a single form field. Returns filled=true when a value went in,
 * or a `blocked` reason when the field is required and only a human can answer it.
 */
async function tryFillField(
  page: Page,
  el: Field,
  facts: Map<string, string>,
  ctx: MatchContext,
): Promise<FillResult> {
  const factKey = matchFact(el.label, el.type, ctx);

  if (!factKey) {
    // A free-text question no fact answers — "What does our value X mean to you?" — gets
    // a written answer (D20). An optional dropdown gets its best option picked. A
    // required unmatched dropdown or short field is usually a fact we lack: a human decides.
    if (el.type === 'textarea') return { filled: false, openEnded: true };
    if (!el.required && (el.type === 'select' || el.type === 'combobox')) return { filled: false, openChoice: true };
    if (el.required) return { filled: false, blocked: `Required field "${el.label}" — no mapping found` };
    return { filled: false, unmatchedText: el.type === 'text' };
  }

  if (factKey === '__checkbox_confirm') {
    // Only consent the form requires. An optional box — e.g. consent to process
    // demographic survey answers — is Vinoth's to give, not the applier's.
    if (!el.required) return { filled: false };
    let ok = false;
    if (el.type === 'checkbox') {
      ok = await page.check(el.selector).then(() => true, () => false);
    } else if (el.type === 'select') {
      ok = await selectByText(page, el.selector, CONSENT_ANSWERS);
    } else if (el.type === 'combobox') {
      ok = await chooseComboboxOption(page, el.selector, CONSENT_ANSWERS);
    }
    return ok ? { filled: true } : { filled: false, blocked: `Could not confirm required consent "${el.label}"` };
  }

  if (factKey === '__ask') {
    return el.required
      ? { filled: false, blocked: `Required field "${el.label}" needs a human answer` }
      : { filled: false };
  }

  if (factKey === '__empty_optional') return { filled: false };

  // A checkbox or radio that isn't consent can't take a typed fact.
  if (el.type === 'checkbox' || el.type === 'radio') {
    return el.required
      ? { filled: false, blocked: `Required ${el.type} "${el.label}" needs a human answer` }
      : { filled: false };
  }

  const fact = facts.get(factKey);
  const value = fact ? valueForField(el.label, fact) : fact;
  if (!value) {
    return el.required
      ? { filled: false, blocked: `Required field "${el.label}" needs fact "${factKey}" which is missing or unapproved` }
      : { filled: false };
  }

  if (el.type === 'select') {
    if (await selectByText(page, el.selector, optionCandidates(factKey, value, facts))) return { filled: true };
    return el.required
      ? { filled: false, blocked: `Required select "${el.label}" has no option matching "${value}"`, tried: value }
      : { filled: false, openChoice: true, tried: value };
  }

  if (el.type === 'number') {
    const numeric = value.replace(/[^0-9.]/g, '');
    if (!numeric) {
      return el.required
        ? { filled: false, blocked: `Required number field "${el.label}" but "${factKey}" is not numeric` }
        : { filled: false };
    }
    await fillTextField(page, el.selector, numeric);
    return { filled: true };
  }

  if (el.type === 'combobox') {
    if (await chooseComboboxOption(page, el.selector, optionCandidates(factKey, value, facts))) return { filled: true };
    return el.required
      ? { filled: false, blocked: `Required dropdown "${el.label}" has no option matching "${value}"`, tried: value }
      : { filled: false, openChoice: true, tried: value };
  }

  await fillTextField(page, el.selector, value);
  return { filled: true };
}

/** Discover form fields on a Greenhouse application page. */
async function discoverFields(page: Page): Promise<Field[]> {
  return page.evaluate(() => {
    const fields: Array<{ selector: string; label: string; type: string; required: boolean }> = [];

    const form =
      document.querySelector('#application_form') ??
      document.querySelector('form[action*="application"]') ??
      document.querySelector('form');
    if (!form) return fields;

    const inputs = form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), textarea, select',
    );
    inputs.forEach((input) => {
      const el = input as HTMLInputElement;
      const id = el.id || el.name || '';
      if (!id) return;
      // The phone field's country picker (intl-tel-input) carries its own hidden search
      // box; it's widget plumbing, not a question. (Inline: this runs in the browser,
      // where a named helper function would reference a bundler shim that isn't there.)
      if (el.classList.contains('iti__search-input') || el.closest('.iti__dropdown-content')) return;

      let label = '';
      const labelEl = form.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (labelEl) {
        label = labelEl.textContent?.trim() ?? '';
      } else {
        const parent = el.closest('.field, .form-group, .application-field');
        if (parent) {
          const lbl = parent.querySelector('label') ?? parent.querySelector('.field__label');
          label = lbl?.textContent?.trim() ?? '';
        }
      }
      if (!label) label = el.placeholder || el.name || id;

      const required =
        el.hasAttribute('required') ||
        el.getAttribute('aria-required') === 'true' ||
        !!el.closest('.field')?.querySelector('.required');

      fields.push({
        selector: el.id ? `#${CSS.escape(el.id)}` : `[name="${CSS.escape(el.name)}"]`,
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

/** Put a human's Discord answer into the field. True if it went in. */
async function fillAnswer(page: Page, field: Field, answer: string): Promise<boolean> {
  if (field.type === 'select') return selectByText(page, field.selector, [answer]);
  if (field.type === 'combobox') return chooseComboboxOption(page, field.selector, [answer]);
  if (field.type === 'checkbox' || field.type === 'radio') return false;
  await fillTextField(page, field.selector, answer);
  return true;
}

export const greenhouse: AtsAdapter = {
  name: 'greenhouse',

  async apply(job: Job, opts: ApplyOptions): Promise<ApplyResult> {
    const screenshots: string[] = [];
    const browser = opts.browser;
    const page = await browser.newPage();
    let submitted = false;

    try {
      console.log(`  🌱 Greenhouse: navigating to ${job['Apply Link']}`);
      await page.goto(job['Apply Link'], { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      // The posting text, for what this company says it values — read before the form opens.
      const posting = await page.innerText('body').catch(() => '');

      // Some Greenhouse pages require clicking an "Apply" button first. Exact text, so
      // "Apply with LinkedIn" or "Apply with MyGreenhouse" are never clicked.
      const applyBtn = await page.$(
        'a[href*="/apply"], a:text-is("Apply for this job"), button:text-is("Apply"), button:text-is("Apply for this job")',
      );
      if (applyBtn) {
        console.log('  → Clicking "Apply" button to open form');
        await applyBtn.click();
        await page.waitForTimeout(2000);
      }

      const fullName = getFact(opts.personalFacts, 'full_name');
      if (!fullName) {
        return { status: 'Blocked', notes: 'full_name is missing from personal.md', screenshots, submitted };
      }
      const { first, last } = splitName(fullName);
      const facts = new Map(opts.personalFacts);
      facts.set('__first_name', first);
      facts.set('__last_name', last);
      const ctx: MatchContext = { jobLocation: job['Location'] ?? '' };

      let fields = await discoverFields(page);
      console.log(`  → Found ${fields.length} form fields`);

      const blockers: Omit<Question, 'n'>[] = [];
      const handled = new Set<string>();
      let filled = 0;

      // Written answers are stored per job, so a live run submits what the dry run showed.
      const writeInto = async (field: Field, question: string): Promise<void> => {
        try {
          let text = opts.answers.generatedAnswer(job['Job ID'], field.label);
          if (!text) {
            console.log(`    ✍️  Writing an answer for "${field.label}"...`);
            text = await writeAnswer({ question, company: job['Company Name'], role: job['Role'], posting, facts });
            opts.answers.saveGenerated(job['Job ID'], field.label, text);
            opts.answers.save();
          }
          await fillTextField(page, field.selector, text);
          filled++;
          console.log(`    ✅ ${field.label} (written — review it in the fill report)`);
        } catch (err) {
          const reason = `Could not write an answer for "${field.label}": ${err instanceof Error ? err.message.slice(0, 120) : err}`;
          if (field.required) blockers.push({ label: field.label, reason });
          console.log(`    ${field.required ? '❌' : '⏭️ '} ${field.label}: ${reason}`);
        }
      };

      /** The last free choice made, e.g. 'What does X mean to you? → "X means to me..."'.
       * A box that appears after it is its follow-up, and needs that as its question. */
      let lastChoice: string | null = null;

      const fillAll = async (list: Field[], followUpOf: string | null = null): Promise<void> => {
        for (const field of list) {
          handled.add(field.selector);
          const result = await tryFillField(page, field, facts, ctx);
          if (result.filled) {
            filled++;
            console.log(`    ✅ ${field.label}`);
            continue;
          }

          if (result.openChoice) {
            const { options } = await optionsForQuestion(page, field);
            let choice = opts.answers.generatedAnswer(job['Job ID'], field.label);
            if (!choice && options?.length) {
              console.log(`    ✍️  Choosing an option for "${field.label}"...`);
              choice = await chooseOption({
                question: field.label, company: job['Company Name'], role: job['Role'], posting, facts, options,
                knownAnswer: result.tried,
              }).catch(() => null);
              if (choice) {
                opts.answers.saveGenerated(job['Job ID'], field.label, choice);
                opts.answers.save();
              }
            }
            if (choice && await fillAnswer(page, field, choice)) {
              filled++;
              if (!result.tried) lastChoice = `${field.label} → "${choice}"`;
              console.log(`    ✅ ${field.label} (chose "${choice}" — review it in the fill report)`);
            } else {
              console.log(`    ⏭️  ${field.label} (skipped — optional, no suitable option)`);
            }
            continue;
          }

          if (result.openEnded) {
            await writeInto(field, followUpOf ? `${followUpOf}\nFollow-up box: ${field.label}` : field.label);
            continue;
          }

          if (result.unmatchedText && followUpOf) {
            await writeInto(field, `${followUpOf}\nFollow-up box: ${field.label}`);
            continue;
          }
          if (!result.blocked) {
            console.log(`    ⏭️  ${field.label} (skipped — optional, ${result.skipped ?? 'no mapping'})`);
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

          blockers.push({ label: field.label, reason, ...(await optionsForQuestion(page, field, result.tried)) });
          console.log(`    ❌ ${field.label}: ${reason}`);
        }
      };

      await fillAll(fields);
      // A choice can reveal a follow-up field — picking '"The Best Team Wins" means to
      // me...' opens a box for the statement. Fill whatever appeared.
      const revealed = (await discoverFields(page)).filter((f) => !handled.has(f.selector));
      if (revealed.length) {
        console.log(`  → ${revealed.length} more field(s) appeared after filling`);
        await fillAll(revealed, lastChoice);
        fields = [...fields, ...revealed];
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

      // What the page says, not what each fill step believed.
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
      }, ['#application_form', 'form[action*="application"]', 'form']);

      if (blockers.length > 0) {
        await askAboutJob(opts.answers, job, blockers);
        return { status: 'Blocked', notes: blockers.map((b) => b.reason).join('; '), screenshots, submitted };
      }

      if (!opts.submit) {
        console.log('  🏁 Dry-run: form filled but NOT submitted');
        return { status: 'Blocked', notes: 'DRY RUN — form filled successfully, not submitted', screenshots, submitted };
      }

      console.log('  🚀 Submitting application...');
      const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Submit")');
      if (!submitBtn) {
        return { status: 'Failed', notes: 'Could not find submit button', screenshots, submitted };
      }

      const formUrl = page.url();
      await submitBtn.click();
      submitted = true;
      await page.waitForTimeout(5000);
      screenshots.push(await browser.screenshot(page, job['Job ID'], 'after-submit'));

      if (await submittedAndConfirmed(page, formUrl, '#application_form, form[action*="application"]')) {
        console.log('  ✅ Confirmation page detected');
        return { status: 'Applied', notes: 'Submitted via Greenhouse, confirmation page seen', screenshots, submitted };
      }

      // Design §8: never trust the page about whether you submitted. The click happened,
      // so this is recorded locally and must not be retried; a human confirms it.
      return {
        status: 'Blocked',
        notes: 'SUBMIT CLICKED, NO CONFIRMATION — check the acknowledgement email before re-applying. ' +
          'Possibly a validation error; see the after-submit screenshot.',
        screenshots,
        submitted,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  💥 Greenhouse error: ${msg}`);
      try {
        screenshots.push(await browser.screenshot(page, job['Job ID'], 'error'));
      } catch { /* ignore screenshot failure */ }
      return { status: 'Failed', notes: `Greenhouse adapter error: ${msg}`, screenshots, submitted };
    } finally {
      await page.close();
    }
  },
};
