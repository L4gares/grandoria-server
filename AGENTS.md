# Grandoria Server Instructions

## Architecture

- Grandoria is a 2D top-down multiplayer RPG.
- GDevelop is the client, and Colyseus is authoritative for real-time gameplay.
- Firebase is the target system only for authentication and persistent data.
- Legacy RTDB systems are temporary migration code. Remove them subsystem by subsystem only after the equivalent Colyseus system is validated, and never reactivate legacy Firebase or local authority accidentally.
- The server determines movement, combat, damage, death, removal, and respawn results.

## Key Files and Validation

- The main room is `src/rooms/MyRoom.ts`.
- The main schemas are in `src/rooms/schema/MyRoomState.ts`.
- Use `npm.cmd` in Windows PowerShell when `npm.ps1` is blocked.
- Run the build and relevant tests after TypeScript changes.
- Preserve the production defaults of a 480 ms death animation and a 10-second respawn unless a future task explicitly changes them.
- Do not trust client identity, position, map, or equipment data without validation.

## Working Rules

- Preserve existing functionality and user-owned uncommitted changes.
- Never commit or push without explicit user authorization.
- Never expose or edit secrets.
- Keep code, identifiers, comments, technical documentation, and logs in English. Keep player-facing interface text in Portuguese.
- Prefer generic, reusable implementations for multiple maps, players, and monster types.
- Do not introduce temporary hardcoded entity IDs when a generic implementation is possible.
