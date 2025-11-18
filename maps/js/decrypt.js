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
    
    // Decrypt ALL encrypted fields recursively
    async function decryptDataStructure(obj) {
        if (obj === null || obj === undefined) {
            return obj;
        }
        
        // Check if this entire object is encrypted
        if (typeof obj === 'object' && obj._encrypted && obj._data) {
            return await decryptValue(obj._data, key);
        }
        
        // Otherwise, decrypt fields within the object
        if (Array.isArray(obj)) {
            return await Promise.all(obj.map(item => decryptDataStructure(item)));
        }
        
        if (typeof obj === 'object') {
            const decryptedObj = {};
            for (const [fieldKey, fieldValue] of Object.entries(obj)) {
                // Skip encryption metadata
                if (fieldKey === '_encryption' || fieldKey === '_encrypted' || fieldKey === '_data') {
                    continue;
                }
                
                // Recursively decrypt nested structures
                decryptedObj[fieldKey] = await decryptDataStructure(fieldValue);
            }
            return decryptedObj;
        }
        
        // Primitive values (strings, numbers, booleans) are returned as-is
        return obj;
    }
    
    // Decrypt metrics structure
    if (decrypted.metrics) {
        console.log('🔓 Decrypting metrics data');
        decrypted.metrics = await decryptDataStructure(decrypted.metrics);
    }
    
    // Decrypt crema data if present
    if (decrypted.crema) {
        console.log('🔓 Decrypting crema data');
        decrypted.crema = await decryptDataStructure(decrypted.crema);
    }
    
    // Decrypt other top-level structures
    for (const key of ['source_targets', 'all_metrics_data']) {
        if (decrypted[key]) {
            decrypted[key] = await decryptDataStructure(decrypted[key]);
        }
    }
    
    return decrypted;
}

/**
 * Show password dialog modal
 * @returns {Promise<string|null>} - Password entered by user, or null if cancelled
 */
function showPasswordDialog() {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            font-family: Poppins, sans-serif;
        `;
        
        // Create modal dialog
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #FFFFFF;
            border-radius: 12px;
            padding: 32px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            animation: fadeIn 0.2s ease-out;
        `;
        
        // Add fade-in animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn {
                from { opacity: 0; transform: scale(0.95); }
                to { opacity: 1; transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
        
        // Create title
        const title = document.createElement('h2');
        title.textContent = '🔐 Decryption Required';
        title.style.cssText = `
            margin: 0 0 16px 0;
            color: #111827;
            font-size: 24px;
            font-weight: 600;
        `;
        
        // Create description
        const desc = document.createElement('p');
        desc.textContent = 'Enter password to decrypt dashboard data:';
        desc.style.cssText = `
            margin: 0 0 24px 0;
            color: #6B7280;
            font-size: 14px;
        `;
        
        // Create password input
        const input = document.createElement('input');
        input.type = 'password';
        input.placeholder = 'Enter password';
        input.autocomplete = 'current-password';
        input.style.cssText = `
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #E5E7EB;
            border-radius: 8px;
            font-size: 16px;
            font-family: Poppins, sans-serif;
            margin-bottom: 24px;
            box-sizing: border-box;
            transition: border-color 0.2s;
        `;
        input.addEventListener('focus', () => {
            input.style.borderColor = '#A51D35';
        });
        input.addEventListener('blur', () => {
            input.style.borderColor = '#E5E7EB';
        });
        
        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 12px;
            justify-content: flex-end;
        `;
        
        // Create cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
            padding: 10px 20px;
            border: 2px solid #E5E7EB;
            border-radius: 8px;
            background: #FFFFFF;
            color: #374151;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            font-family: Poppins, sans-serif;
            transition: all 0.2s;
        `;
        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.backgroundColor = '#F9FAFB';
            cancelBtn.style.borderColor = '#D1D5DB';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.backgroundColor = '#FFFFFF';
            cancelBtn.style.borderColor = '#E5E7EB';
        });
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
            resolve(null);
        });
        
        // Create submit button
        const submitBtn = document.createElement('button');
        submitBtn.textContent = 'Decrypt';
        submitBtn.style.cssText = `
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            background: #A51D35;
            color: #FFFFFF;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            font-family: Poppins, sans-serif;
            transition: all 0.2s;
        `;
        submitBtn.addEventListener('mouseenter', () => {
            submitBtn.style.backgroundColor = '#8B1A2E';
        });
        submitBtn.addEventListener('mouseleave', () => {
            submitBtn.style.backgroundColor = '#A51D35';
        });
        
        const handleSubmit = () => {
            const password = input.value.trim();
            if (password) {
                document.body.removeChild(overlay);
                resolve(password);
            } else {
                input.style.borderColor = '#EF4444';
                input.focus();
            }
        };
        
        submitBtn.addEventListener('click', handleSubmit);
        
        // Handle Enter key
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
            } else if (e.key === 'Escape') {
                document.body.removeChild(overlay);
                resolve(null);
            }
        });
        
        // Handle overlay click (close on outside click)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(null);
            }
        });
        
        // Assemble dialog
        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(submitBtn);
        dialog.appendChild(title);
        dialog.appendChild(desc);
        dialog.appendChild(input);
        dialog.appendChild(buttonContainer);
        overlay.appendChild(dialog);
        
        // Add to page
        document.body.appendChild(overlay);
        
        // Focus input
        setTimeout(() => input.focus(), 100);
    });
}

/**
 * Get decryption key from various sources
 * Priority: 1) User input, 2) API token, 3) Session storage, 4) Password dialog
 */
async function getDecryptionKey() {
    // Don't persist password - always prompt
    // Try to get from API token (if authenticated)
    const apiToken = localStorage.getItem('api_token') || 
                     sessionStorage.getItem('api_token');
    if (apiToken) {
        // Use token as key (or derive from token)
        return apiToken;
    }
    
    // Show password dialog (no persistence)
    const password = await showPasswordDialog();
    if (password) {
        // Don't store - password will be asked again next time
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
        // Load consolidated dashboard_data.json (contains all time ranges)
        const dataPath = `${basePath}/data/dashboard_data.json`;
        const response = await fetch(dataPath + `?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to load dashboard data: ${response.status}`);
        }
        
        const encryptedData = await response.json();
        
        // Check if data is encrypted
        let data = encryptedData;
        if (encryptedData._encryption) {
            // Get decryption key
            const key = await getDecryptionKey();
            if (!key) {
                throw new Error('Decryption key required but not provided');
            }
            
            // Decrypt
            data = await decryptSensitiveFields(encryptedData, key);
            console.log('✅ Dashboard data decrypted successfully');
        } else {
            console.log('📦 Data is not encrypted, returning as-is');
        }
        
        // Extract the specific time range from the consolidated file
        // Structure: { metrics: { this_year: {...}, this_month: {...}, ... }, crema: {...}, source_targets: {...} }
        if (data.metrics && data.metrics[timeRange]) {
            // Return data for the specific time range, preserving other top-level keys
            return {
                ...data,
                metrics: data.metrics[timeRange],
                // Keep source_targets and crema at top level
                source_targets: data.source_targets || {},
                crema: data.crema || {}
            };
        } else {
            // Fallback: return the data as-is (might be old format)
            console.warn(`⚠️ Time range '${timeRange}' not found in consolidated data, returning full data`);
            return data;
        }
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

// Force browser cache refresh
// Deployment timestamp: 2025-11-18T00:52:06Z
