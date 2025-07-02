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

// Path for the snapshot image
const SNAPSHOT_PATH = path.join(__dirname, 'public', 'snapshot.jpg');


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
    await getSnapshot();
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

// Get snapshot on demand
async function getSnapshot() {
    console.log('Getting snapshot on demand...');
    // Try direct API first, fallback to ONVIF
    const success = await getSnapshotDirect() || await getSnapshotONVIF();
    if (!success) {
        console.error('Both snapshot methods failed');
    }
    return success;
}

// Serve static files
app.use(express.static('public'));

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Debug endpoint to check snapshot file status
app.get('/debug', async (req, res) => {
    try {
        const stats = await fs.stat(SNAPSHOT_PATH);
        res.json({
            exists: true,
            size: stats.size,
            modified: stats.mtime,
            path: SNAPSHOT_PATH
        });
    } catch (error) {
        res.json({
            exists: false,
            error: error.message,
            path: SNAPSHOT_PATH
        });
    }
});

// Test endpoint to trigger immediate snapshot
app.get('/test-snapshot', async (req, res) => {
    console.log('Manual snapshot test triggered');
    const success = await getSnapshot();
    res.json({ message: 'Snapshot test completed, check logs', success });
});

// Dynamic snapshot endpoint to accommodate cache-busting filenames like /snapshot/xyz.jpg
app.get('/snapshot/:name.jpg', async (req, res) => {
    await getSnapshot();
    await serveSnapshot(res);
});


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
        
        // On-demand snapshot service ready
        
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