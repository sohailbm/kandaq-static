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
        
        // Explicit mode: 'cache' or 'realtime' (not a fallback)
        // Default: 'cache' for static deployment, 'realtime' for development
        this.mode = options.mode || (options.useCache !== false ? 'cache' : 'realtime');
        
        if (this.mode !== 'cache' && this.mode !== 'realtime') {
            throw new Error(`Invalid mode: ${this.mode}. Must be 'cache' or 'realtime'`);
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
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                return cached.data.metrics;
            }
        }
        
        // Load from cache file
        const cacheData = await this._loadCacheFile(timeRange);
        if (!cacheData || !cacheData.metrics) {
            throw new Error(`Cache file missing or invalid for time range: ${timeRange}`);
        }
        
        // Store in memory
        this._cache.set(cacheKey, {
            data: cacheData,
            timestamp: Date.now()
        });
        
        return cacheData.metrics;
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
        // Construct absolute path to ensure correct resolution
        let cacheFile;
        if (this.cacheDir.startsWith('/')) {
            // Already absolute path
            cacheFile = `${this.cacheDir}/dashboard_data.json`;
        } else if (typeof window !== 'undefined') {
            // Construct absolute path from current page location
            const basePath = window.location.pathname.split('/app')[0] + '/app';
            cacheFile = `${basePath}/${this.cacheDir}/dashboard_data.json`;
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
            
            if (!cremaData) {
                throw new Error('Crema data not found in cache file');
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
            // Remove trailing slash and filename, keep directory
            // For /maps/, this becomes /maps
            // For /maps/index.html, this also becomes /maps
            let basePath = currentPath.replace(/\/[^/]*$/, '');
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
        
        const response = await fetch(cacheFile);
        if (!response.ok) {
            throw new Error(`Cache file not found: ${cacheFile}`);
        }
        
        const allData = await response.json();
        
        // Extract data for the requested time range
        const timeRangeData = allData.metrics?.[timeRange];
        if (!timeRangeData) {
            throw new Error(`Time range '${timeRange}' not found in cache file`);
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
     * Switch mode between 'cache' and 'realtime'
     * @param {string} mode - New mode ('cache' or 'realtime')
     */
    setMode(mode) {
        if (mode !== 'cache' && mode !== 'realtime') {
            throw new Error(`Invalid mode: ${mode}. Must be 'cache' or 'realtime'`);
        }
        this.mode = mode;
        // Clear cache when switching modes
        this.clearCache();
    }
    
    /**
     * Get current mode
     * @returns {string} Current mode ('cache' or 'realtime')
     */
    getMode() {
        return this.mode;
    }
}

// Export for use in apps
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CremaClient;
}

