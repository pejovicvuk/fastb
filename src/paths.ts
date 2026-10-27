import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = process.env.FASTB_HOME ?? join(homedir(), ".fastb");
export const SOCKET = join(HOME, "engine.sock");
export const ENGINE_LOG = join(HOME, "engine.log");
export const PROFILE_DIR = join(HOME, "profile");
export const SHOTS_DIR = join(HOME, "shots");
