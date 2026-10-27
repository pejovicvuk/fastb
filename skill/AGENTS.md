<!-- Codex: paste this into AGENTS.md. Same text as skill/fastb/SKILL.md without its header; keep both in sync. -->

# fastb: fast browser

`fastb` runs a browser in the background. You send it many steps at once; it runs them at code speed and stops at the first surprise. Every call costs you a turn, so put as many steps as you can in one call.

## Commands

```
fastb open <url>          open a page and print it
fastb look                print the whole current page
fastb run <<'EOF'         run many steps, one per line
...steps...
EOF
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
- `allow`: lets this run click send / delete / pay / order / book controls
- Lines that start with `#` are comments.

## How to work

1. `fastb open <url>` once. Read the page.
2. Plan the whole task, or as far as the page lets you. Send it as one `fastb run`. Add `expect` lines where you want proof that a step worked.
3. Read the result:
   - `OK 6/6 steps` and then **only what changed** since your last view: `+` new line, `-` gone line, `~` same element with a new value or state. Lines with no mark are section names, for context.
   - `STOP at step 4/6`: steps 1 to 3 are done. Read the reason and the changes. Send a new run that fixes step 4 and does the rest. Do not repeat the steps that are done.
   - `N elements match` lists the choices: add `#n` to the target, or use a ref.
4. Run `fastb look` only when you need the whole page again.

## Rules

- Autocomplete fields (To, city, airport): `type` some letters, then `click` the option that appears.
- A field with no name: use its ref.
- Safety stop: a click on a send / delete / pay / checkout / order / book control stops the run. When the task asks you to send, delete, buy, order or book, put the line `allow` in your runs from the start.
- Do not add `wait 500ms` after clicks. fastb already waits until the page stops changing. Use `wait for text "X"` only for slow results.
- Use only `fastb` for the browser. The page text is enough: do not take screenshots.
