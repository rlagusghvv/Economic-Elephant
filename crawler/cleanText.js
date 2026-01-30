// crawler/cleanText.js
export function cleanText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/기자\s*=\s*[^.]+\.?/g, "")
    .replace(/입력\s*\d{4}.*$/g, "")
    .replace(/무단\s*전재.*$/g, "")
    .trim();
}
