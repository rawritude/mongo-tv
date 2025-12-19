require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');
const yaml = require('js-yaml');
const path = require('path');

// Configuration from environment
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/?replicaSet=rs0';
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || '';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || '';
const DEFAULT_CONTENT_FORMAT = process.env.DEFAULT_CONTENT_FORMAT || 'yaml';
const DEFAULT_LAYOUT_MODE = process.env.DEFAULT_LAYOUT_MODE || 'list';
const EXCLUDED_COLLECTIONS = process.env.EXCLUDED_COLLECTIONS ? process.env.EXCLUDED_COLLECTIONS.split(',').map(s => s.trim()) : [];

// Express app setup
const app = express();
const server = http.createServer(app);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// WebSocket server
const wss = new WebSocket.Server({ server });

// Track connected clients
const clients = new Set();

// MongoDB client (global for reuse)
let mongoClient = null;
let currentChangeStream = null;
let currentWatchDescription = '';

// Broadcast to all connected clients
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Convert MongoDB change event to friendly format
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

// Clean object for YAML display (unwrap BSON types)
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

  if (Array.isArray(obj)) {
    return obj.map(cleanForYaml);
  }

  if (typeof obj === 'object' && !(obj instanceof Date) && !Buffer.isBuffer(obj)) {
    const newObj = {};
    for (const key in obj) {
      newObj[key] = cleanForYaml(obj[key]);
    }
    return newObj;
  }

  return obj;
}

// Convert to YAML
function toYaml(obj) {
  return yaml.dump(cleanForYaml(obj), {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
}

// API: Get list of databases
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

// API: Get collections in a database
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

// API: Get current config
app.get('/api/config', (req, res) => {
  res.json({
    hasFixedCollection: !!(MONGODB_DATABASE && MONGODB_COLLECTION),
    watching: currentWatchDescription,
    defaultContentFormat: DEFAULT_CONTENT_FORMAT,
    defaultLayoutMode: DEFAULT_LAYOUT_MODE,
    appTitle: process.env.APP_TITLE
  });
});


// Start watching a specific target
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
    console.log(`${change.operationType}: ${change.ns?.coll || 'unknown'}`);

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

// MongoDB connection and initial watch setup
async function connectMongoDB() {
  console.log('Mongo TV Starting...');
  console.log(`Connecting to MongoDB: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);

  mongoClient = new MongoClient(MONGODB_URI, { family: 4 });

  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB');

    // Start watching based on env config
    await startWatching(MONGODB_DATABASE, MONGODB_COLLECTION);

    // Handle process termination
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

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.add(ws);

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    clients.delete(ws);
  });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'selectCollection') {
        // Only allow if not fixed by env
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

  // Send welcome message and current status
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Welcome to Mongo TV!'
  }));

  // Send current watching status
  if (currentWatchDescription) {
    ws.send(JSON.stringify({
      type: 'status',
      status: 'connected',
      watching: currentWatchDescription
    }));
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  connectMongoDB();
});
