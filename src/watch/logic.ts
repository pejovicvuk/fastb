/** SSE uses named events: `lanes` carries an array; `frame` carries { lane, jpegBase64 }. */
export function sseMessage(event: "lanes" | "frame", data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Only accepted frames advance the clock. Use a monotonic time in milliseconds. */
export function shouldForwardFrame(lastSent: number | undefined, now: number): boolean {
  return lastSent === undefined || now - lastSent >= 200;
}

/** Page identity matters even when the lane name stays the same. */
export function diffLanePages<Page>(
  current: ReadonlyMap<string, Page>,
  desired: ReadonlyMap<string, Page>,
): { stop: string[]; start: string[] } {
  return {
    stop: [...current.keys()].filter((name) => !desired.has(name) || desired.get(name) !== current.get(name)),
    start: [...desired.keys()].filter((name) => !current.has(name) || current.get(name) !== desired.get(name)),
  };
}

// The grid shows the step, but never what is typed into a field.
export function safeStep(step: string | undefined): string | undefined {
  return step?.replace(/^((?:fill|type)\s.*?\s=\s).*$/i, "$1•••");
}
