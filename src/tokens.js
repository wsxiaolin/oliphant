// tokens.js — honest, documented token estimation. No black boxes.

/**
 * Rough but consistent token estimate:
 *  - CJK / Hangul chars ≈ 1 token each (modern BPE tokenizers)
 *  - everything else   ≈ 4 chars per token
 * Good enough for budgeting context files; never claim exactness.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other / 4);
}
