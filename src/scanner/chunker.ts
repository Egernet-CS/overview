export function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  const slice = content.slice(0, maxChars);
  const lastNewline = slice.lastIndexOf('\n');
  const truncated = lastNewline > maxChars * 0.8 ? slice.slice(0, lastNewline) : slice;

  const originalLines = content.split('\n').length;
  const shownLines = truncated.split('\n').length;

  return `${truncated}\n// [TRUNCATED: ${originalLines} lines total, showing first ${shownLines}]`;
}
