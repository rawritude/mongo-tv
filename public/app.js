/**
 * Mongo TV - Client-side Application
 * Real-time MongoDB change stream viewer
 */

class MongoTV {
    constructor() {
        // State
        this.ws = null;
        this.isPaused = false;
        this.soundEnabled = false;
        this.docCount = 0;
        this.messageQueue = [];
        this.hasFixedCollection = false;
        this.currentDatabase = null;
        this.currentCollection = null;

        // DOM Elements
        this.screen = document.getElementById('screen');
        this.status = document.getElementById('status');
        this.statusText = this.status.querySelector('.status-text');
        this.watchingTarget = document.getElementById('watchingTarget');
        this.docCountEl = document.getElementById('docCount');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.pauseIcon = document.getElementById('pauseIcon');
        this.clearBtn = document.getElementById('clearBtn');
        this.soundBtn = document.getElementById('soundBtn');
        this.soundIcon = document.getElementById('soundIcon');
        this.welcome = document.getElementById('welcome');

        // Sidebar elements
        this.sidebar = document.getElementById('sidebar');
        this.sidebarToggle = document.getElementById('sidebarToggle');
        this.sidebarClose = document.getElementById('sidebarClose');
        this.sidebarOverlay = document.getElementById('sidebarOverlay');
        this.sidebarContent = document.getElementById('sidebarContent');

        // Footer control buttons
        this.randomColorBtn = document.getElementById('randomColorBtn');
        this.darkModeBtn = document.getElementById('darkModeBtn');
        this.darkModeIcon = document.getElementById('darkModeIcon');
        this.hideErrorsBtn = document.getElementById('hideErrorsBtn');
        this.hideErrorsIcon = document.getElementById('hideErrorsIcon');
        this.zoomInBtn = document.getElementById('zoomInBtn');
        this.zoomOutBtn = document.getElementById('zoomOutBtn');
        this.viewToggleBtn = document.getElementById('viewToggleBtn');
        this.layoutToggleBtn = document.getElementById('layoutToggleBtn');

        // View mode state
        // View mode state
        this.viewMode = localStorage.getItem('viewMode'); // Wait for config if null
        if (this.viewMode) {
            document.body.dataset.viewMode = this.viewMode;
            if (this.viewToggleBtn) this.viewToggleBtn.textContent = this.viewMode.toUpperCase();
        }

        // Layout mode state
        this.layoutMode = localStorage.getItem('layoutMode');
        if (this.layoutMode) {
            document.body.classList.toggle('layout-grid', this.layoutMode === 'grid');
            if (this.layoutToggleBtn) this.layoutToggleBtn.textContent = this.layoutMode === 'grid' ? 'GRID' : 'LIST';
        }

        // Modal elements
        this.detailModal = document.getElementById('detailModal');
        this.modalClose = document.getElementById('modalClose');
        this.modalBody = document.getElementById('modalBody');
        this.modalTitle = document.getElementById('modalTitle');

        // Font size state
        this.fontSize = parseFloat(localStorage.getItem('docFontSize')) || 0.85;
        document.documentElement.style.setProperty('--doc-font-size', `${this.fontSize}rem`);

        // Dark mode state
        this.isDarkMode = localStorage.getItem('darkMode') !== 'false';

        // Hide errors state
        this.hideErrors = localStorage.getItem('hideErrors') === 'true';

        // SVG icons for dark/light mode
        this.moonSvg = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />';
        this.sunSvg = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';

        // SVG icons for pause/play
        this.pauseSvg = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
        this.playSvg = '<polygon points="5 3 19 12 5 21 5 3"/>';

        // SVG icons for sound muted/unmuted
        this.mutedSvg = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
        this.unmutedSvg = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';

        // Audio context for sound effects
        this.audioContext = null;

        // History state
        this.history = [];
        this.MAX_HISTORY = 50;

        // Initialize
        this.bindEvents();
        this.checkConfig();
        this.loadHistory();
        this.connect();
    }

    async checkConfig() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            this.hasFixedCollection = config.hasFixedCollection;

            // Apply application title if set
            if (config.appTitle) {
                document.title = config.appTitle;
                const logoText = document.querySelector('.logo-text');
                if (logoText) logoText.textContent = config.appTitle;
            }

            // Apply defaults if not set locally
            if (!this.viewMode && config.defaultContentFormat) {
                this.viewMode = config.defaultContentFormat;
                document.body.dataset.viewMode = this.viewMode;
                if (this.viewToggleBtn) this.viewToggleBtn.textContent = this.viewMode.toUpperCase();
            }
            // Fallback for view mode
            if (!this.viewMode) {
                this.viewMode = 'yaml';
                document.body.dataset.viewMode = this.viewMode;
                if (this.viewToggleBtn) this.viewToggleBtn.textContent = this.viewMode.toUpperCase();
            }

            if (!this.layoutMode && config.defaultLayoutMode) {
                this.layoutMode = config.defaultLayoutMode;
                document.body.classList.toggle('layout-grid', this.layoutMode === 'grid');
                if (this.layoutToggleBtn) this.layoutToggleBtn.textContent = this.layoutMode === 'grid' ? 'GRID' : 'LIST';
            }
            // Fallback for layout mode
            if (!this.layoutMode) {
                this.layoutMode = 'list';
                if (this.layoutToggleBtn) this.layoutToggleBtn.textContent = 'LIST';
            }

            // Hide toggle if collection is fixed
            if (this.hasFixedCollection) {
                this.sidebarToggle.classList.add('hidden');
            }
        } catch (err) {
            console.error('Failed to get config:', err);
        }
    }

    bindEvents() {
        this.pauseBtn.addEventListener('click', () => this.togglePause());
        this.clearBtn.addEventListener('click', () => this.clearScreen());
        this.soundBtn.addEventListener('click', () => this.toggleSound());
        this.randomColorBtn.addEventListener('click', () => this.randomizeColors());
        this.darkModeBtn.addEventListener('click', () => this.toggleDarkMode());
        this.hideErrorsBtn.addEventListener('click', () => this.toggleHideErrors());

        this.hideErrorsBtn.addEventListener('click', () => this.toggleHideErrors());

        // Zoom controls
        this.zoomInBtn.addEventListener('click', () => this.adjustFontSize(0.1));
        this.zoomOutBtn.addEventListener('click', () => this.adjustFontSize(-0.1));

        // View Toggle
        if (this.viewToggleBtn) {
            this.viewToggleBtn.addEventListener('click', () => this.toggleViewMode());
        }

        // Layout Toggle
        if (this.layoutToggleBtn) {
            this.layoutToggleBtn.addEventListener('click', () => this.toggleLayoutMode());
        }

        // Modal close events
        this.modalClose.addEventListener('click', () => this.closeModal());
        this.detailModal.addEventListener('click', (e) => {
            if (e.target === this.detailModal) this.closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
        });

        // Sidebar events
        this.sidebarToggle.addEventListener('click', () => this.openSidebar());
        this.sidebarClose.addEventListener('click', () => this.closeSidebar());
        this.sidebarOverlay.addEventListener('click', () => this.closeSidebar());

        // Apply saved dark mode preference
        if (!this.isDarkMode) {
            document.body.classList.add('light-mode');
            this.darkModeIcon.innerHTML = this.sunSvg;
        }

        // Apply saved hide errors preference
        if (this.hideErrors) {
            document.body.classList.add('hide-errors');
            this.hideErrorsBtn.classList.add('active');
        }
    }

    toggleDarkMode() {
        this.isDarkMode = !this.isDarkMode;
        document.body.classList.toggle('light-mode', !this.isDarkMode);
        this.darkModeIcon.innerHTML = this.isDarkMode ? this.moonSvg : this.sunSvg;
        localStorage.setItem('darkMode', this.isDarkMode);
    }

    toggleHideErrors() {
        this.hideErrors = !this.hideErrors;
        document.body.classList.toggle('hide-errors', this.hideErrors);
        this.hideErrorsBtn.classList.toggle('active', this.hideErrors);
        localStorage.setItem('hideErrors', this.hideErrors);
    }

    // Generate random harmonious colors
    randomizeColors() {
        const root = document.documentElement;

        // Generate a random base hue
        const baseHue = Math.floor(Math.random() * 360);

        // Create complementary/analogous colors
        const primaryHue = baseHue;
        const secondaryHue = (baseHue + 30 + Math.floor(Math.random() * 60)) % 360;
        const tertiaryHue = (baseHue + 180 + Math.floor(Math.random() * 40) - 20) % 360;

        // Generate HSL colors with good saturation and lightness
        const primary = `hsl(${primaryHue}, 70%, 45%)`;
        const secondary = `hsl(${secondaryHue}, 75%, 55%)`;
        const tertiary = `hsl(${tertiaryHue}, 65%, 50%)`;

        // Apply to CSS variables
        root.style.setProperty('--accent-primary', primary);
        root.style.setProperty('--accent-secondary', secondary);
        root.style.setProperty('--accent-tertiary', tertiary);
        root.style.setProperty('--accent-warm', `hsl(${secondaryHue}, 70%, 60%)`);

        // Update border colors with primary
        root.style.setProperty('--border-color', `hsla(${primaryHue}, 70%, 45%, 0.3)`);
        root.style.setProperty('--border-hover', `hsla(${primaryHue}, 70%, 45%, 0.6)`);

        // Update glows
        root.style.setProperty('--glow-primary', `0 0 20px hsla(${primaryHue}, 70%, 45%, 0.3)`);
        root.style.setProperty('--glow-secondary', `0 0 20px hsla(${secondaryHue}, 75%, 55%, 0.3)`);

        // Play a little sound effect if enabled
        if (this.soundEnabled) {
            this.playSound('UPDATE');
        }

        console.log(`Colors randomized: primary=${primaryHue}°, secondary=${secondaryHue}°, tertiary=${tertiaryHue}°`);
    }

    // Sidebar methods
    openSidebar() {
        this.sidebar.classList.add('open');
        this.sidebarOverlay.classList.add('visible');
        this.loadDatabases();
    }

    closeSidebar() {
        this.sidebar.classList.remove('open');
        this.sidebarOverlay.classList.remove('visible');
    }

    async loadDatabases() {
        this.sidebarContent.innerHTML = '<div class="sidebar-loading">Loading databases...</div>';

        try {
            const response = await fetch('/api/databases');

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${response.status}`);
            }

            const databases = await response.json();

            if (!Array.isArray(databases) || databases.length === 0) {
                this.sidebarContent.innerHTML = '<div class="sidebar-loading">No databases found</div>';
                return;
            }

            this.sidebarContent.innerHTML = databases.map(db => `
                <div class="db-item" data-db="${db}">
                    <div class="db-header">
                        <svg viewBox="0 0 24 24">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                        <span class="db-name">${db}</span>
                    </div>
                    <div class="db-collections">
                        <div class="collections-loading">Loading...</div>
                    </div>
                </div>
            `).join('');

            // Add click handlers for databases
            this.sidebarContent.querySelectorAll('.db-item').forEach(dbItem => {
                const header = dbItem.querySelector('.db-header');
                const arrow = header.querySelector('svg');
                const nameText = header.querySelector('.db-name');
                const dbName = dbItem.dataset.db;

                // Arrow toggles expansion
                arrow.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleDatabase(dbItem);
                });

                // Name selects the database (watch all collections)
                nameText.addEventListener('click', () => {
                    this.selectCollection(dbName, '*');
                });
            });

            // Auto-expand first database
            const firstDb = this.sidebarContent.querySelector('.db-item');
            if (firstDb) {
                this.toggleDatabase(firstDb);
            }

        } catch (err) {
            console.error('Failed to load databases:', err);
            this.sidebarContent.innerHTML = `<div class="sidebar-loading">Failed to load databases: ${err.message}</div>`;
        }
    }

    async toggleDatabase(dbItem) {
        const isExpanded = dbItem.classList.contains('expanded');

        // Close all other expanded items
        this.sidebarContent.querySelectorAll('.db-item.expanded').forEach(item => {
            if (item !== dbItem) item.classList.remove('expanded');
        });

        if (isExpanded) {
            dbItem.classList.remove('expanded');
        } else {
            dbItem.classList.add('expanded');
            await this.loadCollections(dbItem);
        }
    }

    async loadCollections(dbItem) {
        const dbName = dbItem.dataset.db;
        const collectionsContainer = dbItem.querySelector('.db-collections');

        collectionsContainer.innerHTML = '<div class="collections-loading">Loading...</div>';

        try {
            const response = await fetch(`/api/collections/${dbName}`);
            const collections = await response.json();

            if (collections.length === 0) {
                collectionsContainer.innerHTML = '<div class="collections-loading">No collections</div>';
                return;
            }

            collectionsContainer.innerHTML = collections.map(coll => `
                <div class="collection-item${this.currentDatabase === dbName && this.currentCollection === coll ? ' active' : ''}" 
                     data-db="${dbName}" data-collection="${coll}">
                    <svg viewBox="0 0 24 24">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span>${coll}</span>
                </div>
            `).join('');

            // Add click handlers for collections
            collectionsContainer.querySelectorAll('.collection-item').forEach(item => {
                item.addEventListener('click', () => {
                    this.selectCollection(item.dataset.db, item.dataset.collection);
                });
            });

        } catch (err) {
            console.error('Failed to load collections:', err);
            collectionsContainer.innerHTML = '<div class="collections-loading">Failed to load</div>';
        }
    }

    selectCollection(database, collection) {
        // Clear the current stream
        this.clearScreen();

        // Update active state
        this.currentDatabase = database;
        this.currentCollection = collection;

        // Update active class in sidebar
        this.sidebarContent.querySelectorAll('.collection-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.db === database && item.dataset.collection === collection) {
                item.classList.add('active');
            }
        });

        // Send selection to server
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'selectCollection',
                database: database,
                collection: collection
            }));
        }

        // Close sidebar
        this.closeSidebar();
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.setStatus('connected', 'Connected');
        };

        this.ws.onclose = () => {
            this.setStatus('disconnected', 'Disconnected');
            // Auto-reconnect after 3 seconds
            setTimeout(() => this.connect(), 3000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.setStatus('disconnected', 'Error');
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
    }

    handleMessage(data) {
        switch (data.type) {
            case 'welcome':
                console.log(data.message);
                break;

            case 'status':
                if (data.watching) {
                    this.watchingTarget.textContent = data.watching;
                }
                break;

            case 'change':
                if (this.isPaused) {
                    this.messageQueue.push(data);
                } else {
                    this.displayChange(data);
                }
                break;

            case 'error':
                this.displayError(data.message);
                break;
        }
    }

    displayChange(data) {
        // Remove welcome message on first document
        if (this.welcome) {
            this.welcome.remove();
            this.welcome = null;
        }

        // Update count
        this.docCount++;
        this.docCountEl.textContent = this.docCount;

        // Add to history
        this.history.push(data);
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
        }
        this.saveHistory();

        this.renderEntry(data);

        // Play sound if enabled
        if (this.soundEnabled) {
            this.playSound(data.operation);
        }
    }

    renderEntry(data, isHistory = false) {
        // Remove welcome if still there (e.g. loading history)
        if (this.welcome) {
            this.welcome.remove();
            this.welcome = null;
        }

        const entry = document.createElement('div');
        entry.className = 'doc-entry';
        if (!isHistory) entry.classList.add('new');

        const time = new Date(data.timestamp);
        const timeStr = time.toLocaleTimeString();

        // Fallback for JSON view if server hasn't been restarted
        let jsonData = data.json;
        if (!jsonData && data.raw) {
            if (data.raw.document) jsonData = data.raw.document;
            else if (data.raw.updates) jsonData = data.raw.updates;
            else if (data.raw.documentKey) jsonData = { documentKey: data.raw.documentKey };
            else jsonData = data.raw;
        }

        entry.innerHTML = `
      <div class="doc-header">
        <span class="operation-badge ${data.operation}">${data.operation}</span>
        <span class="doc-namespace">${data.namespace}</span>
        <span class="doc-timestamp">${timeStr}</span>
      </div>
      <div class="doc-content">
        <div class="view-yaml">${this.highlightYaml(data.yaml)}</div>
        <div class="view-json">${this.highlightJson(jsonData)}</div>
      </div>
    `;

        entry.addEventListener('click', () => {
            const contentDiv = entry.querySelector('.doc-content');
            this.openModal(contentDiv, data);
        });

        this.screen.appendChild(entry);
        this.screen.scrollTop = this.screen.scrollHeight;

        if (!isHistory) {
            setTimeout(() => entry.classList.remove('new'), 500);
        }
    }

    saveHistory() {
        localStorage.setItem('mongoTV_history', JSON.stringify(this.history));
        localStorage.setItem('mongoTV_docCount', this.docCount);
    }

    loadHistory() {
        const storedHistory = localStorage.getItem('mongoTV_history');
        const storedCount = localStorage.getItem('mongoTV_docCount');

        if (storedCount) {
            this.docCount = parseInt(storedCount, 10);
            this.docCountEl.textContent = this.docCount;
        }

        if (storedHistory) {
            try {
                const history = JSON.parse(storedHistory);
                this.history = history;
                history.forEach(data => this.renderEntry(data, true));
            } catch (e) {
                console.error('Failed to load history', e);
                localStorage.removeItem('mongoTV_history');
            }
        }
    }

    highlightYaml(yaml) {
        if (!yaml) return '';

        let escaped = yaml
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Placeholder strategy for strings to prevent double-highlighting
        const placeholders = [];
        escaped = escaped.replace(/(['"])(?:(?!\1|\\).|\\.)*\1/g, (match) => {
            placeholders.push(match);
            return `__STR_${placeholders.length - 1}__`;
        });

        // Highlight Keys
        escaped = escaped.replace(/^(\s*)([a-zA-Z0-9_\-]+):/gm, '$1<span class="yaml-key">$2</span>:');

        // Highlight Tags (e.g. !!binary)
        escaped = escaped.replace(/!![a-zA-Z0-9_]+/g, '<span class="yaml-tag">$&</span>');

        // Highlight ISO Dates (after keys, before restoring strings)
        escaped = escaped.replace(/:\s+(\d{4}-\d{2}-\d{2}T[\d:.-]+Z?)/g, ': <span class="yaml-date">$1</span>');

        // Highlight Booleans & Nulls
        escaped = escaped.replace(/:\s+(true|false|null)(?=\s|$)/g, ': <span class="yaml-bool">$1</span>');

        // Restore Strings with highlighting class
        escaped = escaped.replace(/__STR_(\d+)__/g, (match, index) => {
            return `<span class="yaml-string">${placeholders[parseInt(index, 10)]}</span>`;
        });

        return escaped;
    }

    displayError(message) {
        const entry = document.createElement('div');
        entry.className = 'doc-entry glitch error';
        entry.innerHTML = `
      <div class="doc-header">
        <span class="operation-badge DELETE">ERROR</span>
        <span class="doc-namespace">${message}</span>
      </div>
    `;
        this.screen.appendChild(entry);
        this.screen.scrollTop = this.screen.scrollHeight;
    }

    setStatus(state, text) {
        this.status.className = `status-indicator ${state}`;
        this.statusText.textContent = text;
    }

    togglePause() {
        this.isPaused = !this.isPaused;

        if (this.isPaused) {
            this.setStatus('paused', 'Paused');
            this.pauseIcon.innerHTML = this.playSvg;
        } else {
            this.setStatus('connected', 'Connected');
            this.pauseIcon.innerHTML = this.pauseSvg;

            // Process queued messages
            while (this.messageQueue.length > 0) {
                this.displayChange(this.messageQueue.shift());
            }
        }
    }

    clearScreen() {
        // Keep only the structure
        this.screen.innerHTML = '';
        this.docCount = 0;
        this.docCountEl.textContent = '0';
        this.messageQueue = [];
        this.history = [];

        localStorage.removeItem('mongoTV_history');
        localStorage.removeItem('mongoTV_docCount');

        // Show welcome back
        const welcome = document.createElement('div');
        welcome.className = 'welcome-message';
        welcome.id = 'welcome';
        welcome.innerHTML = `
      <div class="tv-static"></div>
      <p>Screen cleared!</p>
      <p class="hint">Waiting for new documents...</p>
    `;
        this.screen.appendChild(welcome);
        this.welcome = welcome;
    }

    toggleViewMode() {
        this.viewMode = this.viewMode === 'yaml' ? 'json' : 'yaml';
        document.body.dataset.viewMode = this.viewMode;
        if (this.viewToggleBtn) this.viewToggleBtn.textContent = this.viewMode.toUpperCase();
        localStorage.setItem('viewMode', this.viewMode);
    }

    toggleLayoutMode() {
        this.layoutMode = this.layoutMode === 'grid' ? 'list' : 'grid';
        document.body.classList.toggle('layout-grid', this.layoutMode === 'grid');
        // Button shows what clicking will switch TO? Or what current is?
        // User request: "add option for someone to set grid or single column"
        // Usually toggle buttons show current state or action.
        // My previous logic: if grid, button says 'LIST' (action).
        // Show CURRENT state on button (like View toggle)
        if (this.layoutToggleBtn) this.layoutToggleBtn.textContent = this.layoutMode === 'grid' ? 'GRID' : 'LIST';
        localStorage.setItem('layoutMode', this.layoutMode);
    }

    highlightJson(json) {
        if (!json) return '';
        const str = JSON.stringify(json, null, 2);
        return str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
            function (match) {
                let cls = 'yaml-number';
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'yaml-key';
                    } else {
                        cls = 'yaml-string';
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'yaml-boolean';
                } else if (/null/.test(match)) {
                    cls = 'yaml-null';
                }
                return '<span class="' + cls + '">' + match + '</span>';
            }
        );
    }

    adjustFontSize(delta) {
        this.fontSize = Math.max(0.4, Math.min(3.0, parseFloat((this.fontSize + delta).toFixed(1))));
        document.documentElement.style.setProperty('--doc-font-size', `${this.fontSize}rem`);
        localStorage.setItem('docFontSize', this.fontSize);
    }

    openModal(contentEl, data) {
        this.detailModal.classList.add('open');
        this.modalBody.innerHTML = '';
        this.modalTitle.textContent = `${data.operation} ${data.namespace}`;

        const clone = contentEl.cloneNode(true);
        this.modalBody.appendChild(clone);
    }

    closeModal() {
        this.detailModal.classList.remove('open');
    }

    toggleSound() {
        this.soundEnabled = !this.soundEnabled;
        this.soundIcon.innerHTML = this.soundEnabled ? this.unmutedSvg : this.mutedSvg;

        // Initialize audio context on first enable
        if (this.soundEnabled && !this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    playSound(operation) {
        if (!this.audioContext) return;

        // Create oscillator for retro beep
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Different frequencies for different operations
        const frequencies = {
            'INSERT': 880,   // High pitch - new data
            'UPDATE': 660,   // Medium pitch - change
            'DELETE': 330,   // Low pitch - removal
            'REPLACE': 550   // Mid-high pitch
        };

        oscillator.frequency.value = frequencies[operation] || 440;
        oscillator.type = 'square'; // Retro sound

        // Quick beep
        gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.1);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.mongoTV = new MongoTV();
});
