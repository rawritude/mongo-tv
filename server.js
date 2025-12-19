require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');
const yaml = require('js-yaml');
const path = require('path');

// ==========================================
// Configuration
// ==========================================

/**
 * Port for the Express server to listen on.
 * Defaults to 3000.
 */
const PORT = process.env.PORT || 3000;

/**
 * MongoDB Connection URI.
 * Must point to a MongoDB Replica Set for change streams to function.
 */
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/?replicaSet=rs0';

/** Optional: Limit watching to a specific database */
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || '';

/** Optional: Limit watching to a specific collection */
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || '';

/** Default format for client view (yaml or json) */
const DEFAULT_CONTENT_FORMAT = process.env.DEFAULT_CONTENT_FORMAT || 'yaml';

/** Default layout mode (list or grid) */
const DEFAULT_LAYOUT_MODE = process.env.DEFAULT_LAYOUT_MODE || 'list';

/**
 * List of collections to exclude from the API results.
 * Useful for hiding system collections or high-volume logs.
 */
const EXCLUDED_COLLECTIONS = process.env.EXCLUDED_COLLECTIONS ? process.env.EXCLUDED_COLLECTIONS.split(',').map(s => s.trim()) : [];

// ==========================================
// Server Setup
// ==========================================

const app = express();
const server = http.createServer(app);

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Initialize WebSocket Server
const wss = new WebSocket.Server({ server });

/** Set of active WebSocket clients */
const clients = new Set();

/** Global MongoDB Client instance */
let mongoClient = null;

/** Active Change Stream cursor */
let currentChangeStream = null;

/** Description of the current watch target (for UI display) */
let currentWatchDescription = '';

// ==========================================
// Helper Functions
// ==========================================

/**
 * Broadcasts a data object to all connected WebSocket clients.
 * @param {Object} data - The payload to send.
 */
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Formats a raw MongoDB change event into a cleaner structure for the client.
 * @param {Object} change - The raw change stream event.
 * @returns {Object} A formatted event object.
 */
function formatChangeEvent(change) {
  const operationMap = {
    'insert': 'INSERT',
    'update': 'UPDATE',
    'replace': 'REPLACE',
    'delete': 'DELETE',
    'drop': 'DROP',
    'invalidate': 'INVALIDATE'
  };

  const formatted = {
    operation: operationMap[change.operationType] || change.operationType.toUpperCase(),
    timestamp: new Date().toISOString(),
    namespace: `${change.ns?.db || 'unknown'}.${change.ns?.coll || 'unknown'}`,
    documentKey: change.documentKey,
  };

  // Include full document for inserts/updates/replaces
  if (change.fullDocument) {
    formatted.document = change.fullDocument;
  }

  // Include update description for updates
  if (change.updateDescription) {
    formatted.updates = change.updateDescription;
  }

  return formatted;
}

/**
 * Prepares an object for YAML display by handling BSON types.
 * @param {Object} obj - The object to clean.
 * @returns {Object} The cleaned object.
 */
function cleanForYaml(obj) {
  if (!obj) return obj;

  // Handle BSON Binary
  if (obj._bsontype === 'Binary') {
    return obj.buffer;
  }

  // Handle BSON ObjectId
  if (obj._bsontype === 'ObjectId') {
    return obj.toString();
  }

  // Recursive array handling
  if (Array.isArray(obj)) {
    return obj.map(cleanForYaml);
  }

  // Recursive object handling
  if (typeof obj === 'object' && !(obj instanceof Date) && !Buffer.isBuffer(obj)) {
    const newObj = {};
    for (const key in obj) {
      newObj[key] = cleanForYaml(obj[key]);
    }
    return newObj;
  }

  return obj;
}

/**
 * Converts an object to a YAML string.
 * @param {Object} obj - The object to convert.
 * @returns {string} The YAML string.
 */
function toYaml(obj) {
  return yaml.dump(cleanForYaml(obj), {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
}

// ==========================================
// API Endpoints
// ==========================================

/**
 * GET /api/databases
 * Returns a list of available databases (excluding system dbs).
 */
app.get('/api/databases', async (req, res) => {
  try {
    if (!mongoClient) {
      return res.status(503).json({ error: 'MongoDB not connected' });
    }
    const adminDb = mongoClient.db().admin();
    const result = await adminDb.listDatabases();
    const databases = result.databases
      .filter(db => !['admin', 'local', 'config'].includes(db.name))
      .map(db => db.name);
    res.json(databases);
  } catch (err) {
    console.error('Error listing databases:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/collections/:db
 * Returns a list of collections in the specified database.
 * Filters out collections defined in EXCLUDED_COLLECTIONS.
 */
app.get('/api/collections/:db', async (req, res) => {
  try {
    if (!mongoClient) {
      return res.status(503).json({ error: 'MongoDB not connected' });
    }
    const db = mongoClient.db(req.params.db);
    const collections = await db.listCollections().toArray();
    let collectionNames = collections.map(c => c.name);

    // Filter out excluded collections if configured
    if (EXCLUDED_COLLECTIONS.length > 0) {
      collectionNames = collectionNames.filter(name => !EXCLUDED_COLLECTIONS.includes(name));
    }

    res.json(collectionNames);
  } catch (err) {
    console.error('Error listing collections:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/config
 * Returns public configuration settings for the client.
 */
app.get('/api/config', (req, res) => {
  res.json({
    hasFixedCollection: !!(MONGODB_DATABASE && MONGODB_COLLECTION),
    watching: currentWatchDescription,
    defaultContentFormat: DEFAULT_CONTENT_FORMAT,
    defaultLayoutMode: DEFAULT_LAYOUT_MODE,
    appTitle: process.env.APP_TITLE
  });
});

// ==========================================
// Core Logic
// ==========================================

/**
 * Starts watching a target (Collection, Database, or Deployment).
 * Closes the existing stream if one exists.
 * @param {string} [database] - Database name (optional).
 * @param {string} [collection] - Collection name (optional). ' *' for db watch.
 */
async function startWatching(database, collection) {
  // Close existing change stream
  if (currentChangeStream) {
    await currentChangeStream.close();
    currentChangeStream = null;
  }

  // Determine what to watch
  let watchTarget;
  let watchDescription;

  if (database && collection && collection !== '*') {
    watchTarget = mongoClient.db(database).collection(collection);
    watchDescription = `${database}.${collection}`;
  } else if (database) {
    watchTarget = mongoClient.db(database);
    watchDescription = `${database}.*`;
  } else {
    watchTarget = mongoClient;
    watchDescription = '*.*';
  }

  currentWatchDescription = watchDescription;
  console.log(`Watching: ${watchDescription}`);

  // Create change stream with full document lookup
  const pipeline = [];
  const options = {
    fullDocument: 'updateLookup',
    fullDocumentBeforeChange: 'whenAvailable'
  };

  currentChangeStream = watchTarget.watch(pipeline, options);

  // Broadcast connection info to clients
  broadcast({
    type: 'status',
    status: 'connected',
    watching: watchDescription
  });

  // Listen for changes
  currentChangeStream.on('change', (change) => {
    const formatted = formatChangeEvent(change);

    // Determine what to show in the YAML view (payload only)
    let payload = {};
    if (formatted.document) {
      payload = formatted.document;
    } else if (formatted.updates) {
      payload = formatted.updates;
    } else {
      payload = { documentKey: formatted.documentKey };
    }

    const yamlContent = toYaml(payload);

    broadcast({
      type: 'change',
      operation: formatted.operation,
      namespace: formatted.namespace,
      timestamp: formatted.timestamp,
      yaml: yamlContent,
      json: cleanForYaml(payload),
      raw: formatted
    });
  });

  currentChangeStream.on('error', (err) => {
    console.error('Change stream error:', err.message);
    broadcast({
      type: 'error',
      message: err.message
    });
  });
}

/**
 * Initializes MongoDB connection and starts the default watch.
 * Retries on failure.
 */
async function connectMongoDB() {
  console.log('Mongo TV Starting...');
  // Log URI with masked credentials security
  console.log(`Connecting to MongoDB: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);

  mongoClient = new MongoClient(MONGODB_URI, { family: 4 });

  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB');

    // Start watching based on env config
    await startWatching(MONGODB_DATABASE, MONGODB_COLLECTION);

    // Handle process termination gracefully
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      if (currentChangeStream) await currentChangeStream.close();
      if (mongoClient) await mongoClient.close();
      process.exit(0);
    });

  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    broadcast({
      type: 'error',
      message: `Connection failed: ${err.message}`
    });

    // Retry connection after delay
    setTimeout(() => connectMongoDB(), 5000);
  }
}

// ==========================================
// WebSocket Handlers
// ==========================================

wss.on('connection', (ws) => {
  clients.add(ws);

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    clients.delete(ws);
  });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Handle client requests (e.g., switching collections)
      if (data.type === 'selectCollection') {
        // Prevent switching if environment variables lock the target
        if (MONGODB_DATABASE && MONGODB_COLLECTION) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Collection is fixed by environment configuration'
          }));
          return;
        }

        await startWatching(data.database, data.collection);
      }
    } catch (err) {
      console.error('WebSocket message error:', err.message);
    }
  });

  // Send initial state to new client
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Welcome to Mongo TV'
  }));

  if (currentWatchDescription) {
    ws.send(JSON.stringify({
      type: 'status',
      status: 'connected',
      watching: currentWatchDescription
    }));
  }
});

// ==========================================
// Start Server
// ==========================================

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  connectMongoDB();
});
