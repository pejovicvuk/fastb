---
name: fastb
description: Drive a web browser fast with the fastb CLI. Use for any task that needs a browser - open a site, fill forms, click, check results. Send many steps in one call instead of one tool call per click.
allowed-tools: Bash(fastb:*)
---

# fastb: fast browser

`fastb` runs a browser in the background. You send it many steps at once; it runs them at code speed and stops at the first surprise. Every call costs you a turn, so put as many steps as you can in one call.

## Commands

```
fastb open <url>          open a page and print it
fastb look                print the current page again (a big page is cut to fit)
fastb run <<'EOF'         run many steps, one per line
...steps...
EOF
fastb done                before you answer DONE: checks that the task is really done
```

## The page text

```
page: Inbox | https://mail.example.com/
navigation:
  @e12 link "Inbox · 17"
dialog "New Message":
  @e40 textbox "Subject"
  @e41 combobox
  @e44 button "Send"
```

`@e12` is a ref: a handle to one element. Refs from the latest output are valid. They can look like `@f1e40`.

A big page is cut to fit. `[+40 more like this; fastb look --all shows all]` marks hidden items of a list. `(same: @e70 @e95)` marks the same control shown again with other refs: use one of the refs. Hidden elements still work as targets by their text: `click "Papa Johns Pizza"`. Run `fastb look --all` only when you must read the hidden part.

## Steps

One step per line. Values need no quotes. Labels and names go in double quotes.

- `goto https://site.com/path`
- `click @e44`, `click "Sign in"` (visible text or label), `click button "Save"` (role and name), `click link "Next" #2` (the 2nd match)
- `fill "Email" = bob@x.com`: set a field, found by label, placeholder or ref
- `type @e41 = jona`: press keys one by one (search boxes, autocomplete)
- `select "Size" = Medium`: native or custom dropdown
- `check "I agree"`, `uncheck "Newsletter"`, `hover "Menu"`
- `press Enter`, `press @e41 Enter`
- `wait for text "Saved"`, `wait for gone "Loading"`, `wait 500ms`
- `expect text "Welcome"`, `expect no text "Error"`, `expect url /dashboard`, `expect value "Email" = bob@x.com`: checks; a failed check stops the run
- `allow`: lets this run click send / delete / pay / order / book controls. With a `task` line, it lasts for every later run of that task. (`allow unchecked` also skips the checker, for this run only.)
- `optional click "Accept cookies"`: if the element or text is not there within 2 s (or something covers it), the step is skipped and the run goes on. A safety stop or a `CHECK` is never skipped.
- `if text "Sold out": click "Notify me"`: the step runs only when the page shows the text now (no wait). Also `if no text "X": <step>` and `if url /cart: <step>`. One `if` and one `optional` per step at most: `if text "X": optional click "Y"`.
- `task <text>`: the task of this run or lane, in the user's words. The checker compares the page with it before a send / pay / book click, and `fastb done` checks it at the end. Put it in your first run.
- Lines that start with `#` are comments.

## How to work

1. `fastb open <url>` once. Read the page.
2. Plan the whole task, or as far as you can guess it. Send it as one `fastb run`. Add `expect` lines where you want proof that a step worked.
   - You do not need a ref to act. Target by visible text (`click "Add to cart"`, `click button "Next"`), also for elements that appear only after an earlier step in the same run (a menu item, a dialog button, the next page). fastb waits up to 5 s for each one.
   - A wrong guess costs nothing extra: the run stops at that step and shows you the page. So keep going: after a step that opens a menu, dialog or page, put the steps inside it in the same run.
   - For things that may or may not show up (a cookie banner, a pop-up, a second page of a form), use `optional` or `if` instead of a separate call.
3. Read the result:
   - `OK 6/6 steps` and then **only what changed** since your last view: `+` new line, `-` gone line, `~` same element with a new value or state. Lines with no mark are section names, for context.
   - `STOP at step 4/6`: steps 1 to 3 are done. Read the reason and the changes. Send a new run that fixes step 4 and does the rest. Do not repeat the steps that are done.
   - `skipped step 2: ...`: an `optional` step found nothing, or an `if` did not hold. That step did not run.
   - `N elements match` lists the choices: add `#n` to the target, or use a ref. (Equal copies, as in a carousel, need no choice: fastb clicks the first.)
4. Run `fastb look` only when you need the page again.
5. **Before you answer DONE, run `fastb done`.** A checker compares the task with the steps that really ran and the page now. It answers:
   - `DONE: ...`: answer DONE.
   - `NOT DONE: <what is missing>`: do the missing part (for example, click Send), then run `fastb done` again.
   - `LIKELY DONE: ...`: the final click ran and no error shows. Answer DONE unless you see a problem. Do not search for a proof page.
   - `NO PROOF: ...`: if a link on the page opens the result (Sent, Orders, Bookings), open it once and run `fastb done` again. If not, decide yourself.
   - If it says NOT DONE about a send / pay / book click that already ran, open the page that shows it before you click again: never send or pay twice.
   - After two checks that you are sure are wrong, or when the check is off or failed, decide yourself.

## Many tasks at once: lanes

When you have several tasks or variants that do not depend on each other (test 5 carts, check 3 accounts, do 4 tasks on different sites), run them as lanes in ONE call. Each lane is its own browser with its own cookies and storage. All lanes run at the same time.

```
fastb lanes <<'EOF'
lane us
goto https://shop.example/cart
click "Checkout"
expect text "Total"
lane eu
goto https://shop.example/cart?country=de
click "Checkout"
EOF
```

- The answer starts with one line for all lanes, then each lane's report with its name in front: `[eu] STOP at step 2/3: click "Checkout"`, then that lane's changes only.
- Lanes stay open. To continue several lanes, send `fastb lanes` again with the same lane names: each block goes on in its lane. To continue one lane: `fastb run --lane eu <<'EOF' ... EOF`. To read one lane's page: `fastb look --lane eu`. To read every lane's page in one call: `fastb lanes look`. With many lanes, `fastb lanes report` groups their latest results by cause in a few lines.
- Put every lane you can into the same call. Do not run lanes one after another when they can run together.
- Each lane has its own `allow` and `task` lines.
- Before you answer DONE: `fastb lanes done` checks every lane at once, one line per lane.

## Rules

- Autocomplete fields (To, city, airport): `type` some letters, then `click` the option that appears.
- A field with no name: use its ref.
- Safety stop: a click on a send / delete / pay / checkout / order / book control stops the run. When the task asks you to send, delete, buy, order or book, put the lines `task <the task, in the user's words>` and `allow` in your first run. `allow` then lasts until a new task. Before that click, fastb's checker compares the page with the task. A `CHECK ...` stop means a value on the page does not match the task: fix it, then click again.
- Browser dialogs (alert, confirm): fastb answers them and names them in the answer: `dialog: confirm "..." accepted` or `dismissed`. A confirm is accepted only when it comes from an allowed send / pay / delete click; other confirms are dismissed. A leave-page warning is accepted only for `goto`.
- Do not add `wait 500ms` after clicks. fastb already waits until the page stops changing. Use `wait for text "X"` only for slow results.
- Use only `fastb` for the browser. The page text is enough: do not take screenshots.
