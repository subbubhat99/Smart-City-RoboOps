# Smart City RoboOps · local demo

Smart City RoboOps is a frontend-only operator cockpit for a simulated municipal operation. The interface models autonomous mobile robots performing outdoor groundskeeping and sanitary maintenance of paved public spaces. No backend, database, authentication, camera service, fleet connection, robot, MQTT broker, XProtect or Hafnia service is included.

## Run locally

From the workspace root:

```sh
pnpm install
pnpm --filter @workspace/smart-city-roboops run dev
```

`VITE_GOOGLE_MAPS_API_KEY` is optional. Without it the app renders its interactive Aarhus demo map, with mission routes, service context and restriction polygons. To enable Google Maps road/satellite tiles and the optional Street View link, create a browser key restricted by HTTP referrer to the development and deployment domains, then set:

```sh
VITE_GOOGLE_MAPS_API_KEY=your-domain-restricted-browser-key
```

Restart Vite after changing the environment. Key absence or Google Maps load failure does not prevent the app from running.

`VITE_API_BASE_URL` is an optional future HTTP-client setting (defaults to `/api`). It does not switch the app away from its local mock services.

All demo state is stored in browser `localStorage`; use **Reset demo** to restore the initial record. Simulated observation, fleet response, footage and robot movement are not connected to real systems.

The app defaults to port `5173` and root path `/` when `PORT` and `BASE_PATH` are not supplied, so the same command works outside Replit.

## Demo model notes

- Geographic coordinates (latitude/longitude) are separate from each robot's fleet `mapId` coordinate space. Dispatch is gated by the demo's explicitly predefined alignment.
- Approval, fleet acceptance, robot application, and route replan are separate events.
- GeoJSON Polygon coordinates use `[longitude, latitude]`. Each edit creates a new zone-set ID.
- VDA 5050 3.0 is represented as a fictional adapter target and is not a verified compliance claim.
