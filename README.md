# AIConnect Leaderboards

A lightweight voting app for AIConnect bootcamp teams, built with a Cloudflare Worker and D1.

## MVP behavior

- Participants register using a name only; no accounts or passwords.
- Each participant can rate every system from 1 to 5, and can edit ratings while voting is open.
- The public leaderboard ranks systems by average rating and shows total points and rating counts.
- Voting can be opened or closed by an organizer with access to the D1 database.
- No Cloudflare Turnstile or third-party frontend framework.

## Status

The MVP scaffold is ready for local setup. The actual team entries will be added to `systems.csv` later.

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
   npm run db:local
   ```

3. Start the local server:

   ```sh
   npm run dev
   ```

The starter `systems.csv` contains only its header until the team list is ready. Add one row per team with a stable unique `id`, `name`, and optional `description`.

## API

- `GET /api/status` — voting status
- `GET /api/systems` — approved teams and rating summaries
- `GET /api/leaderboard` — public average ratings, total points, rating counts, and rankings
- `POST /api/participants` — register a display name and receive an opaque participant credential
- `GET /api/me` — retrieve the current participant's ratings (Bearer credential required)
- `PUT /api/ratings` — create or update a 1–5 rating for a system (Bearer credential required; voting must be open)

Participant names are normalized for duplicate detection. A random credential is stored in the browser so a participant can edit their ratings without signing in again. Only a hash of that credential is stored in D1. Name-only registration is appropriate for a casual demo, not a formal election; it does not verify real-world identity.

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

The Worker checks voting status in the same SQL statement that writes a rating, so a request cannot sneak in after voting is closed. Each participant can have at most one rating per system. Rankings are based on average rating; total points and rating counts are shown as context.

## Development and deployment

1. Create a Cloudflare D1 database and set its ID in `wrangler.jsonc`.
2. Apply migrations remotely:

   ```sh
   npm run db:remote
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
