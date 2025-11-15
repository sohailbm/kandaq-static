/**
 * Client-Side Data Decryption
 * 
 * Decrypts sensitive fields in dashboard JSON files.
 * Uses Web Crypto API for secure decryption in the browser.
 */

/**
 * Derive encryption key from password using PBKDF2
 * @param {string} password - User password or secret
 * @param {string} saltBase64 - Base64-encoded salt
 * @param {number} iterations - PBKDF2 iterations
 * @returns {Promise<CryptoKey>} - Encryption key
 */
async function deriveKeyFromPassword(password, saltBase64, iterations = 100000) {
    const salt = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));
    
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );
    
    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        {
            name: 'AES-GCM',
            length: 256
        },
        true,
        ['decrypt']
    );
    
    return key;
}

/**
 * Decrypt a value using AES-GCM
 * @param {string} encryptedBase64 - Base64-encoded encrypted data (IV + ciphertext + tag)
 * @param {CryptoKey} key - Decryption key
 * @returns {Promise<any>} - Decrypted value (parsed JSON)
 */
async function decryptValue(encryptedBase64, key) {
    try {
        // Format: base64(IV(12 bytes) + ciphertext + tag(16 bytes))
        const encrypted = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        
        // Extract IV (first 12 bytes) and ciphertext+tag (rest)
        const iv = encrypted.slice(0, 12);
        const ciphertext = encrypted.slice(12);  // Includes tag at the end
        
        const decrypted = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            key,
            ciphertext
        );
        
        const decryptedText = new TextDecoder().decode(decrypted);
        return JSON.parse(decryptedText);
    } catch (error) {
        console.error('❌ Decryption failed:', error);
        throw new Error('Failed to decrypt data. Invalid key or corrupted data.');
    }
}

/**
 * Decrypt sensitive fields in dashboard data
 * @param {Object} data - Encrypted dashboard data
 * @param {string} password - Decryption password/key
 * @returns {Promise<Object>} - Decrypted data
 */
async function decryptSensitiveFields(data, password) {
    if (!data._encryption) {
        console.warn('⚠️  No encryption metadata found, data may not be encrypted');
        return data;
    }
    
    const encMeta = data._encryption;
    
    // Derive decryption key
    const key = await deriveKeyFromPassword(
        password,
        encMeta.salt,
        encMeta.iterations || 100000
    );
    
    const decrypted = JSON.parse(JSON.stringify(data)); // Deep copy
    
    // Decrypt sensitive fields
    if (decrypted.metrics) {
        // Decrypt top donors
        if (decrypted.metrics.top_donors && 
            decrypted.metrics.top_donors._encrypted) {
            console.log('🔓 Decrypting top_donors');
            decrypted.metrics.top_donors = await decryptValue(
                decrypted.metrics.top_donors._data,
                key
            );
        }
        
        // Decrypt other encrypted fields
        const encryptedFields = [
            'revenue_quickbooks',
            'expenses_quickbooks',
            'net_income_quickbooks'
        ];
        
        for (const field of encryptedFields) {
            if (decrypted.metrics[field] && 
                decrypted.metrics[field]._encrypted) {
                decrypted.metrics[field] = await decryptValue(
                    decrypted.metrics[field]._data,
                    key
                );
            }
        }
    }
    
    return decrypted;
}

/**
 * Get decryption key from various sources
 * Priority: 1) User input, 2) API token, 3) Session storage, 4) Prompt
 */
async function getDecryptionKey() {
    // Try to get from session storage (if user already entered password)
    const storedKey = sessionStorage.getItem('dashboard_decryption_key');
    if (storedKey) {
        return storedKey;
    }
    
    // Try to get from API token (if authenticated)
    const apiToken = localStorage.getItem('api_token') || 
                     sessionStorage.getItem('api_token');
    if (apiToken) {
        // Use token as key (or derive from token)
        return apiToken;
    }
    
    // Prompt user for password
    const password = prompt('Enter password to decrypt dashboard data:');
    if (password) {
        // Store in session (not localStorage for security)
        sessionStorage.setItem('dashboard_decryption_key', password);
        return password;
    }
    
    return null;
}

/**
 * Load and decrypt dashboard data
 * @param {string} timeRange - Time range (e.g., 'this_year')
 * @returns {Promise<Object>} - Decrypted dashboard data
 */
async function loadDecryptedDashboard(timeRange = 'this_year') {
    try {
        // Load encrypted data file
        // Resolve path relative to current page location
        // If path ends with /app, use it; otherwise append /app
        let basePath = window.location.pathname;
        if (!basePath.endsWith('/app')) {
            if (basePath.endsWith('/app/')) {
                basePath = basePath.slice(0, -1);
            } else {
                basePath = basePath.replace(/\/[^/]*$/, '');
                if (!basePath.endsWith('/app')) {
                    basePath = '/tenants/maps/app';
                }
            }
        }
        const dataPath = `${basePath}/data/dashboard_${timeRange}.json`;
        const response = await fetch(dataPath + `?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to load dashboard data: ${response.status}`);
        }
        
        const encryptedData = await response.json();
        
        // Check if data is encrypted
        if (!encryptedData._encryption) {
            console.log('📦 Data is not encrypted, returning as-is');
            return encryptedData;
        }
        
        // Get decryption key
        const key = await getDecryptionKey();
        if (!key) {
            throw new Error('Decryption key required but not provided');
        }
        
        // Decrypt
        const decrypted = await decryptSensitiveFields(encryptedData, key);
        console.log('✅ Dashboard data decrypted successfully');
        
        return decrypted;
    } catch (error) {
        console.error('❌ Failed to load/decrypt dashboard:', error);
        throw error;
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        decryptSensitiveFields,
        loadDecryptedDashboard,
        getDecryptionKey
    };
}

