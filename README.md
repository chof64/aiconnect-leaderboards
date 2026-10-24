# AIConnect Leaderboards

A lightweight voting app for AIConnect bootcamp teams, built with a Cloudflare Worker and D1.

## MVP behavior

- Participants register using a name only; no accounts or passwords.
- Each participant has one active vote and can change it while voting is open.
- The leaderboard is public at all times.
- Voting can be opened or closed by an organizer with access to the D1 database.
- No Cloudflare Turnstile or third-party frontend framework.

## Status

Initial implementation in progress. The actual team entries will be added to `systems.csv` later.

## Quick start

See [Development and deployment](#development-and-deployment) below.

### Requirements

- Node.js and npm
- Cloudflare account
- Wrangler CLI (included as a development dependency)

### Local development

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a local D1 database and apply the schema:

   ```sh
   npx wrangler d1 create aiconnect-leaderboards
   ```

   Copy the returned database ID into `wrangler.jsonc`.

   ```sh
   npx wrangler d1 migrations apply DB --local
   ```

3. Start the local server:

   ```sh
   npm run dev
   ```

The starter `systems.csv` contains only its header until the team list is ready. Add one row per team with a stable unique `id`, `name`, and optional `description`.

## API

- `GET /api/status` — voting status
- `GET /api/systems` — approved teams and current vote totals
- `GET /api/leaderboard` — public totals and rankings
- `POST /api/participants` — register a display name and receive an opaque participant credential
- `GET /api/me` — retrieve the current participant's vote (Bearer credential required)
- `PUT /api/vote` — create or change a vote (Bearer credential required; voting must be open)

Participant names are normalized for duplicate detection. A random credential is stored in the browser so a participant can change their vote without signing in again. Only a hash of that credential is stored in D1. Name-only registration is appropriate for a casual demo, not a formal election; it does not verify real-world identity.

## Voting administration

Voting is controlled by the `voting_config` row in D1. Only the organizer should have access to the database.

Close voting:

```sql
UPDATE voting_config SET is_open = 0 WHERE id = 1;
```

Reopen voting:

```sql
UPDATE voting_config SET is_open = 1 WHERE id = 1;
```

The Worker checks voting status in the same SQL statement that writes a vote, so a request cannot sneak in after the vote is closed.

## Development and deployment

1. Create a Cloudflare D1 database and set its ID in `wrangler.jsonc`.
2. Apply migrations remotely:

   ```sh
   npx wrangler d1 migrations apply DB --remote
   ```

3. Run `npm run dev` for local development or `npm run deploy` to deploy manually.
4. To deploy from GitHub, connect this repository to Cloudflare Workers Builds and configure the build command as `npm run deploy`.

Do not commit API tokens or secrets. This MVP does not require application secrets.

## CSV format

```csv
id,name,description
team-001,Example Team,An example entry
```

IDs should remain stable once voting starts. Removing or changing IDs after votes have been recorded can make existing votes appear outside the active team list.
