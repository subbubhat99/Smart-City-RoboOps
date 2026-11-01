"""Create a source-only overlay ZIP for the October 26 transfer checkout."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    '.gitignore', 'README.md', 'package.json', 'playwright.config.ts', 'docs/gateway-vm.md', 'backend/.env.example',
    'backend/app/config.py', 'backend/app/main.py', 'backend/app/gateway.py',
    'backend/app/gateway_routes.py', 'backend/tests/test_gateway.py',
    'scripts/dev.mjs', 'scripts/start-vm.ps1', 'scripts/configure-demo-camera.ps1',
    'artifacts/smart-city-roboops/frontend/HafniaGatewayPanel.tsx',
    'artifacts/smart-city-roboops/frontend/IntegrationsPanel.tsx',
    'artifacts/smart-city-roboops/frontend/models.ts',
    'tests/browser/operations.spec.ts',
]

INSTRUCTIONS = r'''Smart City RoboOps - VM gateway update

1. Copy this ZIP to the assigned VM. Extract it to a NEW folder.
2. Stop only our app's pnpm dev process with Ctrl+C. Leave XProtect/Hafnia services running.
3. In PowerShell, enter the EXTRACTED UPDATE folder and run:

powershell -ExecutionPolicy Bypass -File .\APPLY-UPDATE.ps1 -TargetPath "C:\Users\Administrator\Desktop\Smart-City-RoboOps-transfer-2026-10-26\Smart-City-RoboOps"

4. Enter the existing application folder, then run:

powershell -ExecutionPolicy Bypass -File .\scripts\start-vm.ps1

The launcher restores the portable Node PATH, pins Python 3.12, and prompts for
the XProtect Basic user and local Hafnia gateway credentials. No passwords are
saved. There are no new package dependencies; do not reinstall node_modules.

5. Open http://127.0.0.1:5173 in the VM. In Connections, test camera access.
   Load saved gateway prompts to verify the gateway login (no VLM submission).
6. Read docs/gateway-vm.md for camera-zone configuration. Import your EXISTING
   successful summary first (no new VLM submission); confirm one proposed incident.
   Then, if desired, submit one new recorded clip (one completed VLM request).

All packaged files are checksummed before replacement; existing versions are
backed up under the application's ignored .gateway-update-backups folder.
The ZIP contains no HackathonKit, passwords, databases, camera mappings,
node_modules or Python environments. It is an overlay for the existing app,
not a standalone full application. GitHub has not been updated by this ZIP.
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    manifest = {'files': []}
    with ZipFile(args.output, 'w', ZIP_DEFLATED) as archive:
        for relative in FILES:
            content = (ROOT / relative).read_bytes()
            archive.writestr('app/' + relative, content)
            manifest['files'].append({'path': relative, 'sha256': hashlib.sha256(content).hexdigest()})
        archive.writestr('manifest.json', json.dumps(manifest, indent=2))
        archive.writestr('APPLY-UPDATE.ps1', (ROOT / 'scripts/apply-gateway-update.ps1').read_bytes())
        archive.writestr('READ-ME-FIRST.txt', INSTRUCTIONS)
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    args.output.with_suffix(args.output.suffix + '.sha256').write_text(digest + '  ' + args.output.name + '\n', encoding='utf-8')
    print(json.dumps({'zip': str(args.output), 'bytes': args.output.stat().st_size, 'application_files': len(FILES), 'sha256': digest}))


if __name__ == '__main__':
    main()
