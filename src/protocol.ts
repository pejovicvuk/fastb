// One JSON line from the CLI, one JSON line back from the engine.

export interface EngineOptions {
  cdp?: string;
  headless?: boolean;
  fresh?: boolean; // temporary empty profile instead of fastb's saved one
}

export interface Request {
  cmd: string;
  args: string[];
  flags: Record<string, string | boolean>;
  options: EngineOptions;
}

export interface Response {
  ok: boolean;
  text: string;
}
