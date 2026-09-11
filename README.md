# TACITA AI-Assisted Interview Support System

Local implementation of the SRS architecture:

- React 18 + Vite + TypeScript frontend
- Node.js / Express REST service and WebSocket audio ingress
- OpenAI through the Vercel AI SDK when `OPENAI_API_KEY` is configured
- Convex Cloud persistence for accounts, interview settings, sessions, transcripts, suggestions, and summaries

## First Local Run

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Copy `.env.example` to `.env`.

3. Start the localhost app:

   ```powershell
   npm.cmd run dev
   ```

4. Open:

   ```text
   http://127.0.0.1:5173
   ```

PowerShell may block `npm.ps1` on this machine, so use `npm.cmd` in the terminal.

Default localhost accounts:

```text
IT Admin: itadmin / itadmin123
Admin: admin / admin123
Interviewer: interviewer / interviewer123
```

These are bootstrapped into Convex if their usernames do not already exist. Change them in `.env` before using the app outside local development.

## Optional OpenAI Setup

Add these values to `.env`:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

Without an API key, starter questions, follow-ups, chat replies, and summaries still work using local deterministic fallbacks.

## Convex Setup

The app stores operational data in Convex Cloud. To prepare or resync the Convex backend:

1. Install dependencies first with `npm.cmd install`.
2. Run:

   ```powershell
   npm.cmd run convex:dev
   ```

3. Follow the Convex CLI login/project prompts.
4. Put the generated `VITE_CONVEX_URL` and `CONVEX_DEPLOYMENT` in `.env`.

The Convex files live in `convex/` and define the hosted database model used by the local API.

## Roles

- IT Admin: create, view, edit, and delete Admin and Interviewer accounts.
- Admin: create, view, edit, and delete interview settings. All setting fields are required. Admins can assign each setting to one interviewer account at a time.
- Interviewer: view only assigned settings, create one or more interview sessions from those settings, generate ACTA starter questions, approve the queue, record/submit transcript content, receive AI follow-ups, chat with the copilot, and generate post-interview outputs.
