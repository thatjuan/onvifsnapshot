require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const onvif = require('node-onvif');
const axios = require('axios');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Camera configuration from environment
const CAMERA_IP = process.env.CAMERA_IP;
const CAMERA_USERNAME = process.env.CAMERA_USERNAME;
const CAMERA_PASSWORD = process.env.CAMERA_PASSWORD;
const ONVIF_PORT = process.env.ONVIF_PORT || 8000;
const POLLING_INTERVAL = parseInt(process.env.POLLING_INTERVAL) || 5000;
const INACTIVITY_TIMEOUT = parseInt(process.env.INACTIVITY_TIMEOUT) || 30000; // 30s without client requests stops polling

// Path for the snapshot image
const SNAPSHOT_PATH = path.join(__dirname, 'public', 'snapshot.jpg');

// Track time of last client snapshot request
let lastSnapshotRequest = 0;

// Client tracking variables (need before routes use them)
let connectedClients = 0;
let pollingInterval = null;

// Serve the latest snapshot with strong no-cache headers. Defined early so it executes before the static middleware.
async function serveSnapshot(res) {
    try {
        const data = await fs.readFile(SNAPSHOT_PATH);
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.end(data);
    } catch (error) {
        console.error('Failed to read snapshot:', error.message);
        res.status(500).json({ error: 'Snapshot not available' });
    }
}

// Snapshot route (fixed filename) placed BEFORE static middleware to override caching.
app.get('/snapshot.jpg', async (req, res) => {
    lastSnapshotRequest = Date.now();
    if (!pollingInterval) await startPolling();
    await serveSnapshot(res);
});

// Ensure public directory exists
async function ensureDirectories() {
    try {
        await fs.mkdir(path.join(__dirname, 'public'), { recursive: true });
    } catch (error) {
        // Silent error handling
    }
}

// Initialize ONVIF device
let device = null;
let snapshotUrl = null;

async function initializeDevice() {
    return new Promise((resolve, reject) => {
        device = new onvif.OnvifDevice({
            xaddr: `https://${CAMERA_IP}:${ONVIF_PORT}/onvif/device_service`,
            user: CAMERA_USERNAME,
            pass: CAMERA_PASSWORD
        });

        device.init((error) => {
            if (error) {
                reject(error);
                return;
            }
            
            resolve();
        });
    });
}

// Get snapshot using direct Reolink API
async function getSnapshotDirect() {
    try {
        const directUrl = `https://${CAMERA_IP}/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=${Date.now()}&user=${CAMERA_USERNAME}&password=${CAMERA_PASSWORD}`;
        console.log('Attempting direct snapshot from:', directUrl);
        
        const response = await axios.get(directUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            auth: {
                username: CAMERA_USERNAME,
                password: CAMERA_PASSWORD
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            })
        });
        
        await fs.writeFile(SNAPSHOT_PATH, response.data);
        console.log('Snapshot saved successfully to:', SNAPSHOT_PATH);
        return true;
    } catch (error) {
        console.error('Direct snapshot failed:', error.message);
        return false;
    }
}

// Get snapshot using ONVIF
async function getSnapshotONVIF() {
    return new Promise((resolve) => {
        if (!device) {
            console.log('ONVIF device not initialized');
            resolve(false);
            return;
        }

        console.log('Attempting ONVIF snapshot...');
        device.fetchSnapshot((error, res) => {
            if (error) {
                console.error('ONVIF snapshot failed:', error.message);
                resolve(false);
                return;
            }
            
            if (res.headers['content-type'] === 'image/jpeg') {
                fs.writeFile(SNAPSHOT_PATH, res.body)
                    .then(() => {
                        console.log('ONVIF snapshot saved successfully to:', SNAPSHOT_PATH);
                        resolve(true);
                    })
                    .catch((err) => {
                        console.error('Failed to save ONVIF snapshot:', err.message);
                        resolve(false);
                    });
            } else {
                console.error('ONVIF response not JPEG:', res.headers['content-type']);
                resolve(false);
            }
        });
    });
}

// Main polling function
async function pollSnapshot() {
    console.log('Polling snapshot...');
    // Try direct API first, fallback to ONVIF
    const success = await getSnapshotDirect() || await getSnapshotONVIF();
    if (!success) {
        console.error('Both snapshot methods failed');
    }
}

// Start polling
async function startPolling() {
    if (pollingInterval) {
        console.log('Polling already active');
        return; // Already polling
    }
    
    console.log('Starting camera polling');
    // Get initial snapshot
    await pollSnapshot();
    
    // Set up polling interval
    pollingInterval = setInterval(() => {
        pollSnapshot().catch(console.error);
    }, POLLING_INTERVAL);
    console.log(`Polling interval set to ${POLLING_INTERVAL}ms`);
}

// Stop polling
function stopPolling() {
    if (!pollingInterval) return; // Not polling
    
    console.log('Stopping camera polling');
    clearInterval(pollingInterval);
    pollingInterval = null;
}

// Serve static files
app.use(express.static('public'));

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Client connection tracking endpoint
app.get('/connect', async (req, res) => {
    connectedClients++;
    console.log(`Client connected. Total clients: ${connectedClients}`);
    
    // Start polling if this is the first client
    if (connectedClients === 1) {
        await startPolling();
    }
    
    res.json({ status: 'connected', clients: connectedClients });
});

// Client disconnection tracking endpoint
app.get('/disconnect', (req, res) => {
    connectedClients = Math.max(0, connectedClients - 1);
    
    // Stop polling if no clients are connected
    if (connectedClients === 0) {
        stopPolling();
    }
    
    res.json({ status: 'disconnected', clients: connectedClients });
});

// Debug endpoint to check snapshot file status
app.get('/debug', async (req, res) => {
    try {
        const stats = await fs.stat(SNAPSHOT_PATH);
        res.json({
            exists: true,
            size: stats.size,
            modified: stats.mtime,
            path: SNAPSHOT_PATH,
            clients: connectedClients,
            polling: pollingInterval !== null
        });
    } catch (error) {
        res.json({
            exists: false,
            error: error.message,
            path: SNAPSHOT_PATH,
            clients: connectedClients,
            polling: pollingInterval !== null
        });
    }
});

// Test endpoint to trigger immediate snapshot
app.get('/test-snapshot', async (req, res) => {
    console.log('Manual snapshot test triggered');
    await pollSnapshot();
    res.json({ message: 'Snapshot test completed, check logs' });
});

// Dynamic snapshot endpoint to accommodate cache-busting filenames like /snapshot/xyz.jpg
app.get('/snapshot/:name.jpg', async (req, res) => {
    lastSnapshotRequest = Date.now();
    if (!pollingInterval) await startPolling();
    await serveSnapshot(res);
});

// Periodically check for inactivity and stop polling if no recent snapshot requests and no tracked clients
setInterval(() => {
    const inactive = Date.now() - lastSnapshotRequest > INACTIVITY_TIMEOUT;
    if (pollingInterval && inactive && connectedClients === 0) {
        console.log('No snapshot requests for a while – stopping polling');
        stopPolling();
    }
}, INACTIVITY_TIMEOUT);

// Start the server
async function start() {
    try {
        // Ensure directories exist
        await ensureDirectories();
        
        // Initialize ONVIF device (optional, as we have direct API)
        try {
            await initializeDevice();
        } catch (error) {
            // Silent fallback to direct API
        }
        
        // Don't start polling until a client connects
        
        // Start Express server
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Camera IP: ${CAMERA_IP}`);
            console.log(`Snapshot path: ${SNAPSHOT_PATH}`);
        });
    } catch (error) {
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    process.exit(0);
});

start();