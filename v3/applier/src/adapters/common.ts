import type { Page } from 'playwright';
import { basename } from 'node:path';

export type FormField = { selector: string; label: string; type: string; required: boolean };

/**
 * Upload the resume to the resume input specifically, and wait until the form shows
 * it attached. A comma-separated selector would return the first file input in
 * document order (a cover-letter slot above the resume gets the resume); and the
 * upload is asynchronous — Greenhouse takes ~3s, and closing the page or submitting
 * before then leaves the application without a resume.
 */
export async function uploadResume(
  page: Page,
  resumePath: string,
): Promise<'attached' | 'no-input' | 'not-confirmed'> {
  const inOrder = [
    'input[type="file"][name*="resume" i]',
    'input[type="file"][id*="resume" i]',
    'input[type="file"][name*="cv" i]',
    'input[type="file"][id*="cv" i]',
    'input[type="file"]:not([name*="cover" i]):not([id*="cover" i])',
  ];
  for (const selector of inOrder) {
    const input = await page.$(selector);
    if (!input) continue;
    console.log(`  📎 Uploading resume: ${resumePath}`);
    await input.setInputFiles(resumePath);
    const name = basename(resumePath);
    try {
      await page.waitForFunction((n) => document.body.innerText.includes(n), name, { timeout: 20000 });
      return 'attached';
    } catch {
      return 'not-confirmed';
    }
  }
  return 'no-input';
}

/** The value a React Select combobox is showing, or null while it shows a placeholder. */
export async function comboboxValue(page: Page, selector: string): Promise<string | null> {
  return page.$eval(selector, (el) => {
    const control = el.closest('[class*="control"]');
    const value = control?.querySelector('[class*="single-value"]')?.textContent?.trim();
    return value || null;
  }).catch(() => null);
}

/**
 * Pick an option in a React Select combobox and confirm it stuck. Type, then wait for
 * the options to load before choosing: location boxes query a remote service, and
 * pressing Enter before the list arrives selects nothing while looking like success.
 */
export async function chooseComboboxOption(page: Page, selector: string, candidates: string[]): Promise<boolean> {
  const input = page.locator(selector);
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text) continue;

    await page.keyboard.press('Escape').catch(() => {});
    await input.click({ force: true });
    await input.fill('');
    await input.pressSequentially(text, { delay: 40 });

    const optionsIn = () => page.$eval(selector, (el) => {
      const listId = el.getAttribute('aria-controls');
      const scope = (listId && document.getElementById(listId)) || el.closest('[class*="container"]');
      return scope ? [...scope.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim() ?? '') : [];
    }).catch(() => [] as string[]);

    let options: string[] = [];
    for (let waited = 0; waited < 6000; waited += 300) {
      await page.waitForTimeout(300);
      options = await optionsIn();
      if (options.length > 0 && !options.every((o) => /loading|no options/i.test(o))) break;
    }

    const index = pickOption(text, options);
    if (index < 0) continue;

    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape').catch(() => {});
    if (await comboboxValue(page, selector)) return true;
  }
  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

/** Options a React Select shows after typing `typed` (or just opening it), then closed again. */
export async function listComboboxOptions(page: Page, selector: string, typed = ''): Promise<string[]> {
  const input = page.locator(selector);
  // Best effort: options are a courtesy for a human or a hint for the model. An input
  // that can't be opened must never fail the whole application.
  try {
    return await readComboboxOptions(page, input, selector, typed);
  } catch {
    return [];
  } finally {
    await input.fill('', { timeout: 2000 }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function readComboboxOptions(
  page: Page,
  input: ReturnType<Page['locator']>,
  selector: string,
  typed: string,
): Promise<string[]> {
  await page.keyboard.press('Escape').catch(() => {});
  await input.click({ force: true, timeout: 3000 });
  await input.fill('', { timeout: 3000 });
  if (typed) await input.pressSequentially(typed, { delay: 40, timeout: 5000 });
  else await input.press('ArrowDown', { timeout: 3000 });

  let options: string[] = [];
  for (let waited = 0; waited < 4000; waited += 300) {
    await page.waitForTimeout(300);
    options = await page.$eval(selector, (el) => {
      const listId = el.getAttribute('aria-controls');
      const scope = (listId && document.getElementById(listId)) || el.closest('[class*="container"]');
      return scope ? [...scope.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim() ?? '') : [];
    }).catch(() => [] as string[]);
    options = options.filter((o) => o && !/^(?:loading|no options|select\.\.\.)/i.test(o));
    if (options.length > 0) break;
  }
  return [...new Set(options)];
}

/** Visible text of every real option in a native <select>, skipping the blank placeholder. */
export async function listSelectOptions(page: Page, selector: string): Promise<string[]> {
  return page.$$eval(`${selector} option`, (opts) =>
    opts.map((o) => o.textContent?.trim() ?? '').filter((t) => t && !/^select/i.test(t)),
  ).catch(() => []);
}

/**
 * What to show a human alongside a blocked question. A fixed list is `choices`; a
 * search box only lists results for what's typed, so we search with the start of
 * the value we tried and offer those as `suggestions`.
 */
export async function optionsForQuestion(
  page: Page,
  field: FormField,
  triedValue?: string,
): Promise<{ options?: string[]; optionsKind?: 'choices' | 'suggestions' }> {
  if (field.type === 'select') {
    const options = await listSelectOptions(page, field.selector);
    return options.length ? { options, optionsKind: 'choices' } : {};
  }
  if (field.type !== 'combobox') return {};

  const fixed = await listComboboxOptions(page, field.selector);
  // Greenhouse's long lists (schools, cities) show only the first 100 until you type.
  // A capped list isn't the whole list, so an answer outside it can't be rejected.
  const capped = fixed.length >= 100;
  if (fixed.length && !capped) return { options: fixed, optionsKind: 'choices' };

  const search = triedValue?.split(/\s+/).slice(0, 2).join(' ');
  const found = search ? await listComboboxOptions(page, field.selector, search) : [];
  if (found.length) return { options: found, optionsKind: 'suggestions' };

  // Nothing close — e.g. an Indian college on a US-centric school list. Offer the list's
  // own escape hatch if it has one, rather than its first hundred entries.
  const other = (await listComboboxOptions(page, field.selector, 'Other')).filter((o) => /^other\b/i.test(o));
  if (other.length) return { options: other, optionsKind: 'suggestions' };
  return {};
}

/**
 * The value a field should receive, shaped by what it asks for. A "…year" field wants
 * just the year: education_start is stored as "2021-12", and stripping non-digits for
 * a number input turned that into 202112.
 */
export function valueForField(label: string, value: string): string {
  if (/\byear\b/i.test(label)) {
    const year = /\b(19|20)\d{2}\b/.exec(value);
    if (year) return year[0];
  }
  return value;
}

export interface FilledValue {
  label: string;
  type: string;
  required: boolean;
  value: string;
}

/** What each field shows on the page right now — read back from the form, not from what was typed. */
export async function readFilledValues(page: Page, fields: FormField[]): Promise<FilledValue[]> {
  const rows: FilledValue[] = [];
  for (const field of fields) {
    const value = field.type === 'combobox'
      ? (await comboboxValue(page, field.selector)) ?? ''
      : await page.$eval(field.selector, (el) => {
          if (el instanceof HTMLSelectElement) {
            return el.selectedIndex > 0 ? (el.options[el.selectedIndex]?.textContent?.trim() ?? '') : '';
          }
          if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
            return el.checked ? '☑ checked' : '';
          }
          return (el as HTMLInputElement).value;
        }).catch(() => '(unreadable)');
    rows.push({ label: field.label.replace(/\s+/g, ' ').trim(), type: field.type, required: field.required, value });
  }
  return rows;
}

/**
 * Labels of required fields that are still empty. The last word before declaring a
 * form filled: every fill path can think it succeeded while the page disagrees.
 */
export async function emptyRequiredFields(page: Page, fields: FormField[]): Promise<string[]> {
  const empty: string[] = [];
  for (const field of fields) {
    if (!field.required) continue;
    const filled = field.type === 'combobox'
      ? (await comboboxValue(page, field.selector)) !== null
      : await page.$eval(field.selector, (el) => {
          if (el instanceof HTMLSelectElement) return el.selectedIndex > 0 || (el.value !== '' && el.selectedIndex >= 0);
          if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
            return el.type === 'checkbox'
              ? el.checked
              : !!document.querySelector(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`);
          }
          return (el as HTMLInputElement).value.trim() !== '';
        }).catch(() => false);
    if (!filled) empty.push(field.label);
  }
  return empty;
}

/**
 * Index of the option meaning `needle`: an exact match, else one containing it as whole
 * words. Whole words matter — "male" is inside "Female", and a plain substring match
 * would answer a gender question with the opposite of the fact.
 */
export function pickOption(needle: string, options: string[]): number {
  const n = needle.trim().toLowerCase();
  if (!n) return -1;
  const exact = options.findIndex((o) => o.trim().toLowerCase() === n);
  if (exact >= 0) return exact;
  const words = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i');
  return options.findIndex((o) => o.trim() !== '' && words.test(o));
}

/**
 * Choose the first option of a <select> whose text contains any of `candidates`
 * (case-insensitive), in order of preference. Selects by index: an option without a
 * value attribute would otherwise select as "", the blank placeholder.
 */
export async function selectByText(page: Page, selector: string, candidates: string[]): Promise<boolean> {
  const options = await page.$$eval(`${selector} option`, (opts) =>
    opts.map((o, index) => ({ index, text: (o.textContent ?? '').trim().toLowerCase() })),
  );
  for (const candidate of candidates) {
    const i = pickOption(candidate, options.map((o) => o.text));
    if (i >= 0) {
      await page.selectOption(selector, { index: options[i]!.index });
      return true;
    }
  }
  return false;
}

const CONFIRMATION_TEXT = /application (?:has been |was )?(?:received|submitted)|thank(?:s| you) for (?:applying|your application)|successfully submitted/i;

/**
 * Whether the submit actually went through. "Thank you" alone isn't evidence — job
 * pages say "thank you for your interest" before anyone submits anything. Evidence is
 * a confirmation URL, or the form having disappeared and confirmation text in its place.
 */
export async function submittedAndConfirmed(page: Page, formUrl: string, formSelector: string): Promise<boolean> {
  const url = page.url();
  if (url !== formUrl && /confirmation|thank/i.test(url)) return true;

  const formStillThere = await page.$(formSelector);
  if (formStillThere) return false;

  const body = (await page.textContent('body').catch(() => '')) ?? '';
  return CONFIRMATION_TEXT.test(body);
}
