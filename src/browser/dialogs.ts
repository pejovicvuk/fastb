import { randomBytes } from "node:crypto";

// Native dialogs (alert, confirm, prompt, leave-page warning). With no handler,
// Playwright closes them in silence, so a confirm() that guards a delete or a send
// was dismissed and the agent never knew. fastb answers each one and says so.
// The dialog text is page text: it goes to the agent's output only, never to the Meta API.

export interface DialogAnswer {
  accept: boolean;
  note: string; // one line for the agent
}

// What the step running on a page now may accept. "leave": a leave-page warning during a
// goto the agent asked for. "confirm": a confirm() that the page called inside the click
// event of an allowed risky click (past the safety gate and its commit check). The runner
// makes the page put `tag` in front of such a confirm's text (see MARK_CONFIRMS in
// chunk/run.ts), so a confirm from a timer or another control has no tag and is dismissed.
export type Arm = { kind: "leave" } | { kind: "confirm"; tag: string };

const TAG = /\u2063fastb:[0-9a-f]+\u2063/g;
export const newTag = () => `\u2063fastb:${randomBytes(6).toString("hex")}\u2063`;

const MAX_TEXT = 100;
const shown = (message: string) => message.replace(TAG, "").replace(/\s+/g, " ").trim().replace(/"/g, "'").slice(0, MAX_TEXT);

// Everything that is not armed is dismissed, the safe answer.
export function dialogAnswer(type: string, message: string, armed?: Arm): DialogAnswer {
  const text = shown(message);
  switch (type) {
    case "alert":
      return { accept: true, note: `dialog: alert "${text}" closed` };
    case "confirm":
      return armed?.kind === "confirm" && message.startsWith(armed.tag)
        ? { accept: true, note: `dialog: confirm "${text}" accepted (it came from the allowed click)` }
        : { accept: false, note: `dialog: confirm "${text}" dismissed (fastb accepts a confirm only during an allowed send / pay / delete click)` };
    case "beforeunload":
      // Unsaved work is lost only for a goto the agent wrote; a link or a page redirect stays.
      return armed?.kind === "leave"
        ? { accept: true, note: "dialog: leave-page warning accepted (unsaved changes on the old page are lost)" }
        : { accept: false, note: "dialog: leave-page warning dismissed, the page stays (to leave anyway, use goto)" };
    default:
      return { accept: false, note: `dialog: ${type} "${text}" dismissed (fastb does not answer prompts)` };
  }
}
