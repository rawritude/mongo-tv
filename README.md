# 📺 Mongo TV

Real-time MongoDB change stream viewer with a retro TV aesthetic.

![Mongo TV](https://img.shields.io/badge/Mongo-TV-00ff9d?style=for-the-badge&logo=mongodb)

## Features

- 🔴 **Real-time streaming** - Watch changes as they happen via WebSocket
- 📝 **YAML formatting** - Documents displayed in readable, syntax-highlighted YAML
- 🎨 **Retro CRT design** - Cyberpunk aesthetic with scanlines and neon glow
- ⏸️ **Pause/Resume** - Control the stream flow
- 🔊 **Sound effects** - Optional retro beeps for new documents
- 🐳 **Dockerized** - Easy deployment

## Quick Start

### Docker (Recommended)

1. Create a `.env` file:
```bash
MONGODB_URI=mongodb://your-host:27017/?replicaSet=rs0
MONGODB_DATABASE=mydb        # Optional: watch specific database
MONGODB_COLLECTION=mycoll    # Optional: watch specific collection
```

2. Run:
```bash
docker compose up -d
```

3. Open http://localhost:3000

### Local Development

```bash
npm install
MONGODB_URI="mongodb://..." npm start
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string (must have replica set) | Required |
| `MONGODB_DATABASE` | Database to watch | All databases |
| `MONGODB_COLLECTION` | Collection to watch | All collections |
| `PORT` | Server port | 3000 |

> ⚠️ **Note**: MongoDB must be running as a replica set for change streams to work.

## Architecture

```
Browser  ←──WebSocket──→  Node.js  ←──Change Stream──→  MongoDB
   📺                        🖥️                          🍃
```

## License

MIT
