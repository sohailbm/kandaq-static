/**
 * Crema Client - Query Object for Kandaq Apps
 * 
 * Provides a clean API for apps to query data instead of reading JSON files directly.
 * Handles cache files, API fallback, and data transformation automatically.
 */

class CremaClient {
    constructor(tenantId, options = {}) {
        this.tenantId = tenantId;
        this.apiUrl = options.apiUrl || 'http://localhost:9010';
        // Cache directory - use relative path 'data' for subdirectory deployments
        // The _loadCacheFile method will construct the correct absolute path
        this.cacheDir = options.cacheDir || 'data';
        
        // Explicit mode: 'cache' or 'live' (not a fallback)
        // Default: 'cache' for static deployment, 'live' for development
        this.mode = options.mode || (options.useCache !== false ? 'cache' : 'live');
        
        if (this.mode !== 'cache' && this.mode !== 'live') {
            throw new Error(`Invalid mode: ${this.mode}. Must be 'cache' or 'live'`);
        }
        
        this.cacheTTL = options.cacheTTL || 3600000; // 1 hour in ms
        this._cache = new Map(); // In-memory cache
    }
    
    /**
     * Get dashboard metrics for a time range
     * @param {string} timeRange - Time range (e.g., 'this_year', 'this_quarter')
     * @returns {Promise<Object>} Metrics object
     */
    async getMetrics(timeRange = 'this_year') {
        if (this.mode === 'cache') {
            return await this._getMetricsFromCache(timeRange);
        } else {
            return await this._fetchMetricsFromAPI(timeRange);
        }
    }
    
    /**
     * Get metrics from cache (cache mode)
     * @private
     */
    async _getMetricsFromCache(timeRange) {
        const cacheKey = `metrics_${timeRange}`;
        
        // Check in-memory cache first
        if (this._cache.has(cacheKey)) {
            const cached = this._cache.get(cacheKey);
            // Check cache file timestamp to see if it's newer than in-memory cache
            try {
                const cacheFile = await this._getCacheFilePath();
                const response = await fetch(cacheFile + `?t=${Date.now()}`, { cache: 'no-cache', method: 'HEAD' });
                const lastModified = response.headers.get('Last-Modified');
                if (lastModified) {
                    const fileTime = new Date(lastModified).getTime();
                    const cacheTime = cached.timestamp;
                    // If file is newer than cache, clear in-memory cache
                    if (fileTime > cacheTime) {
                        this._cache.delete(cacheKey);
                        console.log('🔄 Cache file updated, clearing in-memory cache');
                    }
                }
            } catch (e) {
                // If HEAD request fails, fall through to normal cache check
            }
            
            // Check TTL only if cache wasn't cleared above
            if (this._cache.has(cacheKey)) {
                const cached = this._cache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.cacheTTL) {
                    return cached.data.metrics;
                }
            }
        }
        
        // Load from cache file
        const cacheData = await this._loadCacheFile(timeRange);
        if (!cacheData || !cacheData.metrics) {
            throw new Error(`Cache file missing or invalid for time range: ${timeRange}`);
        }
        
        // Store in memory with full structure for consistency
        this._cache.set(cacheKey, {
            data: cacheData,
            timestamp: Date.now()
        });
        
        return cacheData.metrics;
    }
    
    async _getCacheFilePath() {
        if (this.cacheDir.startsWith('/')) {
            return `${this.cacheDir}/dashboard_data.json`;
        } else if (typeof window !== 'undefined') {
            // Handle both local development (/tenants/maps/app/) and production (/maps/) paths
            let basePath = window.location.pathname;
            
            // Remove trailing filename if present (e.g., /maps/index.html -> /maps)
            basePath = basePath.replace(/\/[^/]+\.html?$/, '');
            
            // Handle production deployment path (/maps/)
            if (basePath.startsWith('/maps') || basePath === '/maps') {
                basePath = '/maps';
            }
            // Handle local development path (/tenants/maps/app/)
            else if (basePath.includes('/tenants/maps/app')) {
                basePath = basePath.replace(/\/tenants\/maps\/app.*$/, '/tenants/maps/app');
            }
            // Try to detect from pathname
            else {
                const appMatch = basePath.match(/(\/tenants\/[^/]+\/app)(?:\/|$)/);
                if (appMatch) {
                    basePath = appMatch[1];
                } else {
                    const tenantMatch = basePath.match(/\/([^/]+)(?:\/|$)/);
                    basePath = tenantMatch ? `/${tenantMatch[1]}/app` : '/maps'; // Default to production path
                }
            }
            
            return `${basePath}/${this.cacheDir}/dashboard_data.json`;
        } else {
            return `${this.cacheDir}/dashboard_data.json`;
        }
    }
    
    /**
     * Get Crema discovery data
     * @returns {Promise<Object>} Crema data object
     */
    async getCremaData() {
        if (this.mode === 'cache') {
            return await this._getCremaDataFromCache();
        } else {
            return await this._fetchCremaFromAPI();
        }
    }
    
    /**
     * Get Crema data from cache (cache mode)
     * @private
     */
    async _getCremaDataFromCache() {
        const cacheKey = 'crema_data';
        
        // Check in-memory cache
        if (this._cache.has(cacheKey)) {
            const cached = this._cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                return cached.data;
            }
        }
        
        // Load from consolidated dashboard_data.json (contains Crema data)
        // Use same path resolution as _loadCacheFile
        let cacheFile;
        if (this.cacheDir.startsWith('/')) {
            // Already absolute path
            cacheFile = `${this.cacheDir}/dashboard_data.json`;
        } else if (typeof window !== 'undefined') {
            // Use relative path from current page location
            // Works for both /tenants/maps/app/ and /maps/ deployments
            const currentPath = window.location.pathname;
            
            // Check for /app pattern FIRST on the original path (before removing segments)
            // This ensures /tenants/maps/app matches app pattern, not maps pattern
            const appMatch = currentPath.match(/(\/tenants\/[^/]+\/app)(?:\/|$)/);
            let basePath;
            
            if (appMatch) {
                // Development: /tenants/maps/app -> /tenants/maps/app
                basePath = appMatch[1];
            } else {
                // Production: /maps/ or /maps/index.html -> /maps
                // Remove trailing slash and filename, keep directory
                basePath = currentPath.replace(/\/[^/]*$/, '');
                // If path includes GitHub Pages base (e.g., /kandaq-static/maps), extract just /maps
                const mapsMatch = basePath.match(/(\/maps)(?:\/|$)/);
                if (mapsMatch) {
                    basePath = mapsMatch[1];
                }
            }
            
            // Ensure basePath doesn't end with double slash
            basePath = basePath.replace(/\/+$/, '') || '/';
            // Construct cache file path
            cacheFile = `${basePath}/${this.cacheDir}/dashboard_data.json`;
            // Clean up any double slashes
            cacheFile = cacheFile.replace(/\/+/g, '/');
        } else {
            // Fallback to relative path
            cacheFile = `${this.cacheDir}/dashboard_data.json`;
        }
        
        try {
            const response = await fetch(cacheFile);
            if (!response.ok) {
                throw new Error(`Cache file not found: ${cacheFile}`);
            }
            
            const allData = await response.json();
            const cremaData = allData.crema;
            
            // Crema data is optional - return null if not available instead of throwing
            if (!cremaData || (typeof cremaData === 'object' && Object.keys(cremaData).length === 0)) {
                // Store null in cache to avoid repeated fetches
                this._cache.set(cacheKey, {
                    data: null,
                    timestamp: Date.now()
                });
                return null;
            }
            
            // Store in memory cache
            this._cache.set(cacheKey, {
                data: cremaData,
                timestamp: Date.now()
            });
            
            return cremaData;
        } catch (e) {
            throw new Error(`Failed to load Crema data: ${e.message}`);
        }
    }
    
    /**
     * Get sources (from Crema data)
     * @returns {Promise<Array>} Array of source objects
     */
    async getSources() {
        const cremaData = await this.getCremaData();
        return cremaData?.sources || [];
    }
    
    /**
     * Get categories (from Crema data)
     * @returns {Promise<Array>} Array of category objects
     */
    async getCategories() {
        const cremaData = await this.getCremaData();
        return cremaData?.categories || [];
    }
    
    /**
     * Get data types (from Crema data)
     * @returns {Promise<Array>} Array of data type objects
     */
    async getDataTypes() {
        const cremaData = await this.getCremaData();
        return cremaData?.data_types || [];
    }
    
    /**
     * Get collection statistics
     * @returns {Promise<Object>} Collection stats object
     */
    async getCollectionStats() {
        const cremaData = await this.getCremaData();
        return cremaData?.collectionStats || {};
    }
    
    /**
     * Get entity data (query entities by type)
     * @param {string} entityType - Entity type (e.g., 'donation', 'invoice')
     * @param {Object} filters - Filter options
     * @returns {Promise<Array>} Array of entity records
     */
    async getEntityData(entityType, filters = {}) {
        const query = this._buildEntityQuery(entityType, filters);
        return await this.search(query);
    }
    
    /**
     * Search using query
     * @param {string} query - Query string
     * @param {Object} options - Search options (limit, offset, etc.)
     * @returns {Promise<Array>} Search results
     */
    async search(query, options = {}) {
        // Try API
        try {
            const response = await fetch(`${this.apiUrl}/api/query`, {
                method: 'POST',
                headers: {
                    'X-Tenant-ID': this.tenantId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query, ...options })
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.results || data.data?.results || [];
            }
        } catch (e) {
            console.error('❌ Search failed:', e);
            throw e;
        }
    }
    
    /**
     * Load cache file
     * @private
     */
    async _loadCacheFile(timeRange) {
        // Load from consolidated dashboard_data.json (single file with all time ranges)
        // Construct path relative to current page location (works for both /app and /maps)
        let cacheFile;
        if (this.cacheDir.startsWith('/')) {
            // Already absolute path
            cacheFile = `${this.cacheDir}/dashboard_data.json`;
        } else if (typeof window !== 'undefined') {
            // Use relative path from current page location
            // Works for both /tenants/maps/app/ and /maps/ deployments
            const currentPath = window.location.pathname;
            
            // Check for /app pattern FIRST on the original path (before removing segments)
            // This ensures /tenants/maps/app matches app pattern, not maps pattern
            const appMatch = currentPath.match(/(\/tenants\/[^/]+\/app)(?:\/|$)/);
            let basePath;
            
            if (appMatch) {
                // Development: /tenants/maps/app -> /tenants/maps/app
                basePath = appMatch[1];
            } else {
                // Production: /maps/ or /maps/index.html -> /maps
                // Remove trailing slash and filename, keep directory
                basePath = currentPath.replace(/\/[^/]*$/, '');
                // If path includes GitHub Pages base (e.g., /kandaq-static/maps), extract just /maps
                const mapsMatch = basePath.match(/(\/maps)(?:\/|$)/);
                if (mapsMatch) {
                    basePath = mapsMatch[1];
                }
            }
            
            // Ensure basePath doesn't end with double slash
            basePath = basePath.replace(/\/+$/, '') || '/';
            // Construct cache file path
            cacheFile = `${basePath}/${this.cacheDir}/dashboard_data.json`;
            // Clean up any double slashes
            cacheFile = cacheFile.replace(/\/+/g, '/');
        } else {
            // Fallback to relative path
            cacheFile = `${this.cacheDir}/dashboard_data.json`;
        }
        
        // Add cache-busting query parameter to ensure fresh data
        const cacheBuster = `?t=${Date.now()}`;
        const response = await fetch(cacheFile + cacheBuster, {
            cache: 'no-cache'
        });
        if (!response.ok) {
            throw new Error(`Cache file not found: ${cacheFile}`);
        }
        
        const allData = await response.json();
        
        // Extract data for the requested time range
        let timeRangeData = allData.metrics?.[timeRange];
        
        // If exact time range not found, try fallback to broader ranges
        if (!timeRangeData) {
            console.warn(`⚠️ Time range '${timeRange}' not found, trying fallback...`);
            
            // Fallback order: try broader time ranges
            const fallbackMap = {
                'today': ['this_week', 'this_month', 'this_year'],
                'this_week': ['this_month', 'this_year'],
                'last_week': ['this_month', 'this_year', 'last_month'],
                'this_month': ['this_quarter', 'this_year'],
                'last_month': ['this_quarter', 'this_year', 'last_quarter', 'last_year'],
                'this_quarter': ['this_year'],
                'last_quarter': ['this_year', 'last_year'],
                'last_year': ['this_year', 'all_time'],
                'all_time': ['this_year']
            };
            
            const fallbacks = fallbackMap[timeRange] || [];
            for (const fallback of fallbacks) {
                if (allData.metrics?.[fallback]) {
                    console.log(`✅ Using fallback time range: ${fallback}`);
                    timeRangeData = allData.metrics[fallback];
                    break;
                }
            }
            
            // If still not found, use this_year as final fallback
            if (!timeRangeData && allData.metrics?.['this_year']) {
                console.log(`✅ Using final fallback: this_year`);
                timeRangeData = allData.metrics['this_year'];
            }
            
            if (!timeRangeData) {
                throw new Error(`Time range '${timeRange}' not found in cache file and no fallback available`);
            }
        }
        
        // Return in the same format as old separate files
        return {
            tenant_id: allData.tenant_id,
            time_range: timeRange,
            business_type: allData.business_type,
            date_range: timeRangeData.date_range,
            timestamp: timeRangeData.timestamp,
            cached_at: allData.cached_at,
            cache_version: allData.cache_version,
            metrics: timeRangeData.metrics,
            source_targets: timeRangeData.source_targets,
            all_metrics_data: timeRangeData.all_metrics_data
        };
    }
    
    /**
     * Expose _loadCacheFile for external use (for encrypted files)
     * @public
     */
    async loadCacheFile(timeRange) {
        return await this._loadCacheFile(timeRange);
    }
    
    /**
     * Fetch metrics from API
     * @private
     */
    async _fetchMetricsFromAPI(timeRange) {
        const response = await fetch(
            `${this.apiUrl}/api/metrics?time_range=${timeRange}`,
            {
                headers: {
                    'X-Tenant-ID': this.tenantId,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!response.ok) {
            throw new Error(`Failed to fetch metrics: ${response.status}`);
        }
        
        const data = await response.json();
        return data.metrics || data.data?.metrics;
    }
    
    /**
     * Fetch Crema data from API
     * @private
     */
    async _fetchCremaFromAPI() {
        const response = await fetch(`${this.apiUrl}/api/crema`, {
            headers: {
                'X-Tenant-ID': this.tenantId,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch Crema data: ${response.status}`);
        }
        
        const data = await response.json();
        return data.data || data;
    }
    
    /**
     * Build entity query
     * @private
     */
    _buildEntityQuery(entityType, filters) {
        // Simple query builder - can be enhanced
        let query = `data_type=${entityType}`;
        
        // Add filters
        if (filters.dateRange) {
            query += ` AND date >= ${filters.dateRange.start} AND date <= ${filters.dateRange.end}`;
        }
        
        if (filters.amountMin) {
            query += ` AND amount >= ${filters.amountMin}`;
        }
        
        if (filters.amountMax) {
            query += ` AND amount <= ${filters.amountMax}`;
        }
        
        return query;
    }
    
    /**
     * Check if cache is valid (only in cache mode)
     * @param {string} timeRange - Time range to check
     * @returns {boolean} True if cache is valid
     */
    isCacheValid(timeRange) {
        if (this.mode !== 'cache') {
            return false; // Not using cache mode
        }
        
        const cacheKey = `metrics_${timeRange}`;
        if (!this._cache.has(cacheKey)) {
            return false;
        }
        
        const cached = this._cache.get(cacheKey);
        return Date.now() - cached.timestamp < this.cacheTTL;
    }
    
    /**
     * Clear in-memory cache
     */
    clearCache() {
        this._cache.clear();
    }
    
    /**
     * Switch mode between 'cache' and 'live'
     * @param {string} mode - New mode ('cache' or 'live')
     */
    setMode(mode) {
        if (mode !== 'cache' && mode !== 'live') {
            throw new Error(`Invalid mode: ${mode}. Must be 'cache' or 'live'`);
        }
        this.mode = mode;
        // Clear cache when switching modes
        this.clearCache();
    }
    
    /**
     * Get current mode
     * @returns {string} Current mode ('cache' or 'live')
     */
    getMode() {
        return this.mode;
    }
}

// Export for use in apps
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CremaClient;
}

