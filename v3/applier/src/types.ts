/** A job row from the Sheet, as returned by doGet. */
export type Job = {
  'Job ID': string;
  'Company Name': string;
  'Role': string;
  'Location': string;
  'Salary': string;
  'Apply Link': string;
  'ATS': string;
  'Job Match': string;
  'Gate Result': string;
  'Status': string;
  'Applied At': string;
  'Notes': string;
  'Discovered At': string;
  /** Resume version chosen by Apps Script (Resumes.gs), e.g. "paypal"; blank until matched. */
  'Resume'?: string;
  /** Why that version was chosen. */
  'Resume Match'?: string;
};

/** What an adapter returns after attempting one application. */
export type ApplyResult = {
  status: 'Applied' | 'Blocked' | 'Failed';
  notes: string;
  screenshots: string[];
  /** True once the submit button was clicked, whether or not a confirmation was seen.
   * The CLI records these locally so a failed Sheet write can never cause a re-apply. */
  submitted: boolean;
};

/** Parsed personal fact. */
export type PersonalFact = {
  key: string;
  value: string;
  source: string;
  approved: boolean;
  expiresAt: string | null;
  sensitivity: string;
  notes: string;
};

import type { Browser } from './browser.js';
import type { AnswerStore } from './questions.js';

/** Options passed through the CLI to every adapter. */
export type ApplyOptions = {
  submit: boolean;       // false = dry-run (fill but don't click submit)
  headed: boolean;       // true = visible browser
  profileDir: string;    // path to persistent browser profile
  screenshotDir: string; // where to save screenshots
  personalFacts: Map<string, string>;  // key → value from personal.md
  resumePath: string;    // path to the resume to upload
  browser: Browser;      // shared browser instance
  answers: AnswerStore;  // answers given in Discord, and questions still waiting
};

/** The interface every ATS adapter implements. */
export type AtsAdapter = {
  name: string;
  apply: (job: Job, opts: ApplyOptions) => Promise<ApplyResult>;
};
