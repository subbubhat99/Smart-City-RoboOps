# Hafnia gateway connector on the assigned VM

This implementation follows HackathonKit's `hafnia-vlm` gateway API. HackathonKit
is not distributed in this repository. The adapter has automated mock coverage;
live camera access, gateway results and event delivery must be tested on your VM.
No live inference requests are made by the automated tests.

## Start after reboot

From the project root inside the assigned pNNN VM:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-vm.ps1
```

The launcher finds portable Node.js under `%LOCALAPPDATA%\RoboOpsTools`, restores
PATH for the app process, selects Python 3.12, and prompts locally for credentials:

1. XProtect Basic user: `Smart-City-RoboOps`, with its own password and role.
2. Hafnia gateway user: `administrator`, with the supplied Windows password.

Existing nonempty process credentials are reused. If changing accounts/passwords,
close that PowerShell session and start a fresh one. Passwords are never written
by the launcher. Keep them out of source, .env files, screenshots and chat.
No XProtect services, firewall or Tailscale settings are changed.
The supplied self-signed certificate exception applies exclusively to the fixed
`https://localhost:15443` gateway client. XProtect and other HTTPS clients retain
their existing behavior. Do not expose this VM app directly to the internet.

If dependencies were never installed, use `-InstallDependencies` once. This update
adds no third-party dependencies; existing installs do not need reinstalling.

Open `http://127.0.0.1:5173` in Edge INSIDE the VM. Leave the operator session token
blank unless you configured `ROBOOPS_OPERATOR_TOKEN`; it is not an XProtect password.

## Lowest-cost first test: import the working summary

1. In Connections, click **Test camera access** and find the scooter camera ID.
2. Configure a real surveyed zone, or explicitly opt into this illustrative demo
   helper (replace the placeholder with the actual camera GUID):

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\configure-demo-camera.ps1 -CameraId "YOUR-CAMERA-GUID" -Illustrative
   ```

   This maps the camera to fictional demo geometry, NOT its real location. It
   preserves other mappings and refuses to replace an existing camera mapping.
   The mapping is stored in ignored `backend/camera-zones.json`, outside the ZIP.
   `ROBOOPS_CAMERA_ZONES`, if set, overrides that path; edit the configured file
   instead of using this helper. No backend restart is needed for mapping changes.

3. Open the gateway page at `https://localhost:15443/`. Find the completed summary
   in History. If its ID is not shown there, use Swagger (`/api/swagger/`) to log in,
   authorize the returned session, and list `/api/Summaries` with `Limit=10`.
   Match the camera, clip times and response. Never paste the session into chat.
4. In RoboOps **Hafnia gateway - recorded video**, paste the summary ID into
   **Existing summary ID** and click **Import existing result - no new analysis**.
   Imports, prompt reads and status checks do not submit a new clip.
5. A response consisting of `OBSTRUCTION_CONFIRMED` (optional final period or !)
   creates exactly one proposed incident once the mapping exists. Its note and
   stored evidence include the summary ID, camera, clip times, answer and mapping
   label. Repeated imports/refreshes reuse the incident. If the mapping was missing,
   add it, then click **Refresh result**; do not rerun the VLM.

`PATH_CLEAR` never clears existing restrictions. `UNCERTAIN`, contradictory text,
free-form descriptions and malformed results create no incident automatically.
Review the answer manually in these cases.

## Submit one new clip from RoboOps

1. Load XProtect cameras and saved gateway prompts.
2. Select the camera and the exact saved prompt linked to your gateway rule. IDs
   are shown to distinguish duplicate titles. The backend sends both `PromptId`
   and its current saved `Text`, so gateway rule evaluation remains available.
3. Select a recorded interval from the last 24 hours, 1-120 seconds long, ending
   in the past. Inputs are explicitly UTC even if your browser uses local time.
4. Confirm the quota checkbox, then click **Analyze recorded clip - one request**.
   One completed analysis costs one of the gateway's 500 daily requests. The app
   additionally caps its own submissions at 20 per UTC day by default, including
   uncertain attempts, and allows only one pending submission at a time. Imports
   do not consume this local budget. Other gateway clients share the upstream
   allowance; the app cap does not reserve or measure that remaining allowance.
5. Watch progress. Status refreshes use the accepted summary ID; they never submit
   another clip. Jobs survive backend restarts and demo reset. Reload saved jobs
   after reconnecting. Automatic status checks stop after 10 minutes or a connection
   error; use manual Refresh afterward.

On a submission timeout, the gateway may already have accepted the clip. The job
is marked **Submission uncertain**, and the app does not retry automatically.
Find it in gateway History and import its summary ID. An interrupted **Submitting**
reservation also needs History inspection; importing a known summary resolves
the reservation state. Do not repeatedly click Analyze to recover an uncertain job.

Your existing gateway rule and XProtect alarm definition evaluate newly completed
summaries. Keep activation **Time profile - Always**, the appropriate camera source,
and analytics-event reception enabled. A result event must never trigger another
Hafnia request. A directly submitted summary does not automatically create a bookmark.

## Limits

- Fleet acknowledgements/replanning remain simulated. Real observations cannot be
  dispatched to fictional fleets. This patch does not implement VDA 5050 exports.
- The gateway response is shown in Connections and referenced in the incident.
  This patch does not add embedded recorded-video playback.
- Existing Smart Client summary import is explicit; this is not an unattended
  subscriber to every alarm or every historical summary.
- Gateway sessions are cached for up to eight hours and renewed after a 401.
- Replit/public access and an outbound VM connector are separate deployment work.

## Acceptance check on the VM

Import the known working result first (zero new VLM submissions), confirm one
Proposed incident, refresh/import again to verify no duplicate, then restart our
app and verify the job and incident remain. Next budget one new completed clip
analysis to verify dashboard submission and the existing XProtect alarm rule.
Do not restart the Hafnia service to test application persistence.
