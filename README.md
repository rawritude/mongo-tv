# Mongo TV

Real-time MongoDB change stream viewer with a modern web interface.
<img width="939" height="771" alt="image" src="https://github.com/user-attachments/assets/3ec0f04f-f80f-4f34-9d24-379a05b19efb" />


## Overview

Mongo TV connects to your MongoDB replica set, listens for change stream events (inserts, updates, deletes), and broadcasts them in real-time to a connected web client via WebSockets. The interface provides a customizable, responsive experience with support for Grid/List layouts, JSON/YAML formatting, and document persistence.

## Architecture

    +---------+       +-------------------+       +-----------------+
    | MongoDB | <---> | Node.js Server    | <---> | Web Client      |
    | (Repl)  |       | (Standard/Socket) |       | (Browser)       |
    +---------+       +-------------------+       +-----------------+
         |                      ^                          ^
         | Change Stream        |                          |
         +----------------------+                          |
                                                           |
                                      WebSocket Broadcast  |
                                      +--------------------+

1.  **MongoDB**: Generates change events (must be a Replica Set).
2.  **Server**: Node.js app uses the MongoDB Node Driver to watch collection(s).
3.  **Broadcast**: Events are formatted and sent to all connected clients via `ws`.
4.  **Client**: Single-page application renders events in a responsive Grid or List view.

## Features

*   **Real-time Monitoring**: Instant updates for database operations.
*   **Flexible Layouts**: Toggle between a dense "List" stream or a visual "Grid" card view.
*   **Data Formatting**: View payloads in clean YAML or raw JSON.
*   **Persisted History**: Local storage saves recent logs and settings across reloads.
*   **Responsive Design**: Fully optimized for mobile, tablet, and desktop.
*   **Customizable**: Configurable titles, filters, and defaults via environment variables.

## Configuration

Configure the application using a `.env` file in the root directory.

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGODB_URI` | Connection string (Replica Set required) | `mongodb://localhost:27017...` |
| `MONGODB_DATABASE` | Target database name | (All Databases) |
| `MONGODB_COLLECTION` | Target collection name | (All Collections) |
| `PORT` | Web server port | `3000` |
| `APP_TITLE` | Custom application title | `Mongo TV` |
| `DEFAULT_LAYOUT_MODE` | Initial UI layout (`list` or `grid`) | `list` |
| `DEFAULT_CONTENT_FORMAT` | Initial data format (`yaml` or `json`) | `yaml` |
| `EXCLUDED_COLLECTIONS` | Comma-separated list of collections to hide | (None) |

### Example .env

```properties
MONGODB_URI=mongodb://user:pass@mongo-host:27017/?replicaSet=rs0
APP_TITLE=Production Log Stream
DEFAULT_LAYOUT_MODE=grid
EXCLUDED_COLLECTIONS=system.views,admin_logs
```

## Installation

### Using Docker (Recommended)

1.  Create your `.env` file as shown above.
2.  Run the container:

```bash
docker-compose up -d
```

3.  Access the interface at `http://localhost:3000`.

### Manual Installation

1.  Install dependencies:
    ```bash
    npm install
    ```

2.  Start the application:
    ```bash
    npm start
    ```

## Development

*   **Server**: `server.js` handles MongoDB connections and WebSocket broadcasting.
*   **frontend**: `public/app.js` manages state, filtering, and DOM updates.
*   **Styles**: `public/style.css` contains all visual definitions including responsive rules.

## License

MIT
