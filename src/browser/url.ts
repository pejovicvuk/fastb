// "example.com" -> "https://example.com"; full URLs and about: pages stay as they are.
export function withScheme(url: string): string {
  return /^[a-z]+:\/\//i.test(url) || url.startsWith("about:") ? url : `https://${url}`;
}
