# PrusaLapse Server & Container Deployment Guide

PrusaLapse can be deployed to any Linux home server, NAS, or cloud VPS as a lightweight container or standalone Node.js service.

---

## 1. Quick Start: Docker Compose (Recommended)

1. Clone or download the repository, or grab `docker-compose.yml` and `Dockerfile`.
2. Start the service:
   ```bash
   docker compose up -d
   ```
3. Open your browser and navigate to:
   ```
   http://<YOUR_SERVER_IP>:3000
   ```

### Storage Persistence:
The container automatically creates and mounts two directories in the same folder as `docker-compose.yml`:
* `./captures` — All session folders, high-res photos, and compiled `.mp4` videos.
* `./config` — Your printer IP, API keys, and camera preferences (`prusa-lapse.config.json`).

---

## 2. Docker CLI Run

If running directly via `docker run`:

```bash
docker run -d \
  --name prusalapse \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /var/prusalapse/captures:/app/public/captures \
  -v /var/prusalapse/config:/app/config \
  -e TZ=Europe/Madrid \
  prusalapse:latest
```

---

## 3. CasaOS / ZimaOS / Cosmos

1. Open **CasaOS App Store** $\rightarrow$ Click **Custom Install** (top right).
2. Set the following fields:
   * **App Name**: `PrusaLapse`
   * **Docker Image**: `prusalapse:latest` (or build locally)
   * **Web UI Port**: `3000` $\rightarrow$ Container `3000`
   * **Volumes**:
     * Host: `/DATA/AppData/prusalapse/captures` $\rightarrow$ Container: `/app/public/captures`
     * Host: `/DATA/AppData/prusalapse/config` $\rightarrow$ Container: `/app/config`
3. Click **Submit**.

---

## 4. TrueNAS SCALE / Unraid

* **Network Mode**: Bridge or Host (ensure port 3000 is forwarded).
* **Storage / Mount Paths**:
  * Set host path for `/app/public/captures` (e.g. `/mnt/user/appdata/prusalapse/captures`).
  * Set host path for `/app/config` (e.g. `/mnt/user/appdata/prusalapse/config`).
* **Environment Variables**:
  * `PORT=3000`
  * `HOSTNAME=0.0.0.0`
  * `TZ=<Your_Timezone>`

---

## 5. Headless Linux / Raspberry Pi (systemd)

For users running directly on a Raspberry Pi or Debian/Ubuntu without Docker:

1. Install Node.js 20 LTS and FFmpeg:
   ```bash
   sudo apt update && sudo apt install -y nodejs ffmpeg curl
   ```
2. Download the pre-built `prusalapse-v1.3.0-server-standalone.zip` and extract to `/opt/prusalapse`:
   ```bash
   sudo mkdir -p /opt/prusalapse
   sudo unzip prusalapse-v1.3.0-server-standalone.zip -d /opt/prusalapse
   sudo chown -R $USER:$USER /opt/prusalapse
   ```
3. Copy the systemd service unit:
   ```bash
   sudo cp deploy/systemd/prusalapse.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now prusalapse
   ```
4. Check service status:
   ```bash
   sudo systemctl status prusalapse
   ```
