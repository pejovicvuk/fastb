// "example.com" -> "https://example.com"; full URLs, about: and data: pages stay as they are.
export function withScheme(url: string): string {
  return /^[a-z]+:\/\//i.test(url) || /^(about|data):/i.test(url) ? url : `https://${url}`;
}
