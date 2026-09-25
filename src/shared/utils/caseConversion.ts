/** Pure English case converters used by deterministic house-style findings. */

const SMALL_TITLE_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "nor",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "v",
  "via",
]);

function capitalizeWord(word: string): string {
  const chars = [...word];
  const first = chars[0];
  if (first === undefined) return word;
  return first.toLocaleUpperCase() + chars.slice(1).join("").toLocaleLowerCase();
}

export function toSentenceCase(text: string): string {
  const result = text.toLocaleLowerCase();
  let sentenceStart = true;
  return [...result]
    .map((char) => {
      if (sentenceStart && /\p{L}/u.test(char)) {
        sentenceStart = false;
        return char.toLocaleUpperCase();
      }
      if (/[.!?]/u.test(char)) sentenceStart = true;
      return char;
    })
    .join("");
}

export function toTitleCase(text: string): string {
  const words = text.split(/(\s+)/u);
  const wordIndexes = words
    .map((word, index) => (/[\p{L}\p{N}]/u.test(word) ? index : -1))
    .filter((index) => index >= 0);
  const firstWord = wordIndexes[0];
  const lastWord = wordIndexes.at(-1);

  return words
    .map((word, index) => {
      if (!/[\p{L}\p{N}]/u.test(word)) return word;
      if (/^[A-Z0-9]+$/u.test(word) && [...word].length > 1) return word;
      const normalized = word.toLocaleLowerCase();
      if (index !== firstWord && index !== lastWord && SMALL_TITLE_WORDS.has(normalized)) {
        return normalized;
      }
      return capitalizeWord(word);
    })
    .join("");
}
