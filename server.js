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

// Path for the snapshot image
const SNAPSHOT_PATH = path.join(__dirname, 'public', 'snapshot.jpg');

// Client tracking
let connectedClients = 0;
let pollingInterval = null;

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
        return true;
    } catch (error) {
        return false;
    }
}

// Get snapshot using ONVIF
async function getSnapshotONVIF() {
    return new Promise((resolve) => {
        if (!device) {
            resolve(false);
            return;
        }

        device.fetchSnapshot((error, res) => {
            if (error) {
                resolve(false);
                return;
            }
            
            if (res.headers['content-type'] === 'image/jpeg') {
                fs.writeFile(SNAPSHOT_PATH, res.body)
                    .then(() => {
                        resolve(true);
                    })
                    .catch((err) => {
                        resolve(false);
                    });
            } else {
                resolve(false);
            }
        });
    });
}

// Main polling function
async function pollSnapshot() {
    // Try direct API first, fallback to ONVIF
    await getSnapshotDirect() || await getSnapshotONVIF();
}

// Start polling
async function startPolling() {
    if (pollingInterval) return; // Already polling
    
    console.log('Starting camera polling');
    // Get initial snapshot
    await pollSnapshot();
    
    // Set up polling interval
    pollingInterval = setInterval(pollSnapshot, POLLING_INTERVAL);
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
        app.listen(PORT);
    } catch (error) {
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    process.exit(0);
});

start();