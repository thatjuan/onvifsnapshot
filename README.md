# Reolink Camera Snapshot Web App

A simple Node.js web application that polls a Reolink camera via ONVIF protocol to display live snapshots.

## Features

- Polls camera snapshots at configurable intervals
- Supports both ONVIF protocol and direct Reolink API
- Minimal web interface showing only the camera image
- Auto-refreshing display
- Environment variable configuration

## Setup

### Option 1: Using Node.js

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your camera details:
   ```env
   CAMERA_IP=192.168.1.100
   CAMERA_USERNAME=admin
   CAMERA_PASSWORD=your_camera_password
   ONVIF_PORT=8000
   PORT=3000
   POLLING_INTERVAL=5000
   ```

5. Ensure ONVIF is enabled on your Reolink camera:
   - Go to Network > Advanced > Port Settings
   - Enable ONVIF (default port 8000)

6. Start the server:
   ```bash
   npm start
   ```

7. Open your browser to `http://localhost:3000`

### Option 2: Using Docker

1. Build the Docker image:
   ```bash
   docker build -t backlanecam .
   ```

2. Run the container:
   ```bash
   docker run -d \
     --name backlanecam \
     -p 3000:3000 \
     -e CAMERA_IP=192.168.1.100 \
     -e CAMERA_USERNAME=admin \
     -e CAMERA_PASSWORD=your_camera_password \
     -e ONVIF_PORT=8000 \
     -e POLLING_INTERVAL=5000 \
     backlanecam
   ```

   Or using a `.env` file:
   ```bash
   docker run -d \
     --name backlanecam \
     -p 3000:3000 \
     --env-file .env \
     backlanecam
   ```

3. Open your browser to `http://localhost:3000`

## Environment Variables

- `CAMERA_IP`: IP address of your Reolink camera
- `CAMERA_USERNAME`: Camera username
- `CAMERA_PASSWORD`: Camera password
- `ONVIF_PORT`: ONVIF service port (default: 8000)
- `PORT`: Web server port (default: 3000)
- `POLLING_INTERVAL`: Milliseconds between snapshot updates (default: 5000)

## How It Works

The application tries two methods to get snapshots:
1. Direct Reolink API (`/cgi-bin/api.cgi?cmd=Snap`)
2. ONVIF protocol (as fallback)

The web interface displays the snapshot image fullscreen and refreshes it automatically.