/**
 * Best-effort requisition ID extraction from subject/snippet text — companies word
 * this differently, so this is a heuristic, not a parser. A miss just means the
 * message falls through to the next matching tier, never a wrong guess.
 */
export function extractRequisitionId(text: string): string | null {
  const m = /\b(?:req(?:uisition)?|job)\s*(?:id|no\.?|number|#)?\s*[:#\-]?\s*([A-Za-z]{0,4}[-\s]?\d{3,10})\b/i.exec(text);
  return m ? m[1]!.replace(/\s+/g, '') : null;
}
