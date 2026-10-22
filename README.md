kajs website

## Running locally

Install dependencies with `npm install`, then start the live server with `npm start`. This runs `server.js`, which serves the site, API routes, and WebSocket endpoints on `http://localhost:3000` outside production.

## Multiplayer

Run `npm start` and open `http://localhost:3000/game.html` in two or more browser tabs or devices (on a LAN use the host's IP address). The game connects to the WebSocket server on the same host after you press Join Game, shows "N online" next to the Dev button, and plays as single player if no server is reachable.

- Other players appear as avatars, or as the car or plane they are in, with name tags.
- Press `T` or `Enter` (or tap 💬) to chat; shots, plane explosions, kills and PvP hits are shared.
- Add `?server=ws://host:port` to the URL to use a different game server, or `?multiplayer=0` to turn multiplayer off.
- Traffic, pedestrians and police are simulated separately by each player.
