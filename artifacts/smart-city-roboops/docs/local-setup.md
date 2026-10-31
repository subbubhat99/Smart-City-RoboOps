# Local setup

See the repository-root `README.md` for current instructions. This project now has a Python/FastAPI backend; the older frontend-only/localStorage setup has been replaced.

- Windows on this checkout: `powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1`.
- Standard environment: install dependencies with `pnpm install --frozen-lockfile`, then `pnpm dev`.
- Dashboard: http://localhost:5173; API docs: http://127.0.0.1:8000/docs.
- Built single-process app: `pnpm build:app`, then `pnpm start`, at http://127.0.0.1:8000.
- Optional browser configuration: `.env` beside the frontend package; optional server configuration: `backend/.env`.
- XProtect and Hafnia setup, camera-zone mapping, optional event poller, tests and deployment limits are documented in the root README.
