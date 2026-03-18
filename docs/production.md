# Production

Impression runs on **c.quick-lint-js.com** (Ubuntu 22.04) as a systemd service.
Deployment is managed with **Ansible** — the playbook, inventory, and service
template live in `deploy/`.

## Deploying

Make sure you have a `.env` file in the project root (it gets copied to the
server). Then run:

```sh
ansible-playbook -i deploy/inventory.ini deploy/playbook.yml
```

The playbook builds the frontend locally (`npm run build`), rsyncs the
necessary files to the server, installs production dependencies, and
restarts the service if anything changed.

## Running production mode locally

```sh
npm ci
npm run build
npm ci --omit=dev  # Optional.
NODE_ENV=production PORT=3011 node --env-file-if-exists=.env.prod backend/main.ts
```

Then open <http://localhost:3011/>.

## Logs

SSH into the server and use `journalctl`:

```sh
ssh root@c.quick-lint-js.com

# follow live logs
journalctl -u impression -f

# last 100 lines
journalctl -u impression -n 100
```

## Service management

```sh
# on the server
systemctl status impression
systemctl restart impression
```

## How it works

- Node.js is installed from the NodeSource apt repository.
- The app runs as a `impression` system user under `/home/impression/app/`.
- In production (`NODE_ENV=production`), Express serves the pre-built frontend
  from `frontend/dist/` with an SPA fallback — Vite is not used at runtime.
- The service listens on port 3011.
