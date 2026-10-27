# fastb

Fast browser execution for AI coding agents (Claude Code, Codex).

Built for the Meta AI Developer Hackathon (Oct 26 to Nov 5, 2026).

## Status

Phase 1 (engine skeleton) works: `open`, `look`, `status`, `stop`.

## Try it

```
npm install
npm run build
node dist/cli.js open evals-dashdish.vercel.app
node dist/cli.js look
node dist/cli.js look --shot
node dist/cli.js stop
```

Use a Chrome you started yourself with `--remote-debugging-port=9222`:

```
node dist/cli.js open example.com --cdp http://127.0.0.1:9222
```

Run `node dist/cli.js` with no arguments for all commands.
