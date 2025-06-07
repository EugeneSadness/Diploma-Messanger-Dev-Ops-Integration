const vault = require('node-vault');
// Using console for logging instead of a separate logger module

/**
 * Configuration for Vault client
 * Default values are for development
 */
const VAULT_CONFIG = {
  apiVersion: 'v1',
  endpoint: process.env.VAULT_ADDR || 'http://vault:8200',
  token: process.env.VAULT_TOKEN || 'fullstack-root-token',
  // Добавляем таймаут для запросов к Vault
  timeout: 5000,
  // Добавляем путь к секретам
  mount: 'secret'
};

/**
 * Vault client instance
 */
let vaultClient = null;

/**
 * Initialize the Vault client
 * @returns {Object} - The initialized Vault client
 */
const initVault = async () => {
  try {
    if (vaultClient) {
      return vaultClient;
    }

    console.log('Initializing Vault client');
    
    // Create a new Vault client
    vaultClient = vault(VAULT_CONFIG);
    
    try {
      // Verify connection to Vault with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), 3000);
      });
      
      const statusPromise = vaultClient.status();
      const status = await Promise.race([statusPromise, timeoutPromise]);
      console.log(`Connected to Vault. Status: ${status.initialized ? 'Initialized' : 'Not Initialized'}`);
    } catch (connError) {
      console.warn(`Could not connect to Vault: ${connError.message}. Will use environment variables as fallback.`);
      // Создаем заглушку вместо реального клиента
      vaultClient = {
        read: () => Promise.reject(new Error('Vault unavailable')),
        write: () => Promise.reject(new Error('Vault unavailable')),
        delete: () => Promise.reject(new Error('Vault unavailable')),
        list: () => Promise.reject(new Error('Vault unavailable')),
        health: () => Promise.reject(new Error('Vault unavailable')),
        status: () => Promise.reject(new Error('Vault unavailable'))
      };
    }
    
    return vaultClient;
  } catch (error) {
    console.error(`Failed to initialize Vault client: ${error.message}`);
    // Создаем заглушку вместо выбрасывания исключения
    vaultClient = {
      read: () => Promise.reject(new Error('Vault unavailable')),
      write: () => Promise.reject(new Error('Vault unavailable')),
      delete: () => Promise.reject(new Error('Vault unavailable')),
      list: () => Promise.reject(new Error('Vault unavailable')),
      health: () => Promise.reject(new Error('Vault unavailable')),
      status: () => Promise.reject(new Error('Vault unavailable'))
    };
    return vaultClient;
  }
};

/**
 * Read a secret from Vault
 * @param {string} path - Path to the secret
 * @param {string} key - Optional key within the secret
 * @returns {Promise<any>} - The secret value
 */
const readSecret = async (path, key = null) => {
  // Define all path variables at the top level to ensure they're always available
  let secretPath = '';
  let kvDataPath = '';
  let originalPath = path;
  
  try {
    // Ensure Vault client is initialized
    const client = await initVault();
    
    console.log(`Чтение секрета из Vault по пути: ${path}`);
    
    // First try with secret/ prefix which is the standard mount point
    async function tryReadPath(pathToTry) {
      console.log(`Попытка чтения секрета по пути: ${pathToTry}`);
      const { data } = await client.read(pathToTry);
      
      // Handle KV v2 storage format which nests data under a 'data' field
      if (key && data && data.data) {
        return data.data[key];
      } else if (data && data.data) {
        return data.data;
      }
      
      // Return the entire data object for KV v1 or other formats
      return data;
    }
    
    // Check if path already has a mount point prefix
    if (path.startsWith('secret/')) {
      // Path already has the correct prefix
      return await tryReadPath(path);
    } else if (!path.includes('/')) {
      // For simple paths without a slash, try with secret/ prefix
      secretPath = `secret/${path}`;
      return await tryReadPath(secretPath);
    } else {
      // For paths that might be partial paths like app/database
      secretPath = `secret/${path}`;
      kvDataPath = path.startsWith('kv/data/') ? path : `kv/data/${path}`;
      
      // First try with secret/ prefix
      try {
        return await tryReadPath(secretPath);
      } catch (secretPathError) {
        console.log(`Не удалось прочитать секрет из ${secretPath}: ${secretPathError.message}`);
        
        // If secret/ fails, try with the KV path pattern
        if (path.startsWith('kv/data/')) {
          // Path already has kv/data/ prefix
          try {
            return await tryReadPath(path);
          } catch (kvPrefixError) {
            console.log(`Не удалось прочитать секрет из ${path}: ${kvPrefixError.message}`);
            // Last resort, try original path
            return await tryReadPath(originalPath);
          }
        } else {
          // Try with kv/data/ prefix as fallback
          try {
            return await tryReadPath(kvDataPath);
          } catch (kvDataPathError) {
            console.log(`Не удалось прочитать секрет из ${kvDataPath}: ${kvDataPathError.message}`);
            
            // As a last resort, try the original path
            return await tryReadPath(originalPath);
          }
        }
      }
    }
  } catch (error) {
    console.error(`Failed to read secret from ${path}: ${error.message}`);
    
    let triedPaths = [originalPath];
    if (secretPath) triedPaths.push(secretPath);
    if (kvDataPath) triedPaths.push(kvDataPath);
    
    console.log(`Не удалось получить секреты по пути '${path}'. Tried paths: ${triedPaths.join(', ')}`);
    
    // Проверяем, есть ли переменная окружения с таким же именем
    if (key && path.includes('/')) {
      const envKey = path.split('/').pop().toUpperCase() + '_' + key.toUpperCase();
      console.log(`Trying to use environment variable ${envKey} as fallback`);
      
      if (process.env[envKey]) {
        console.log(`Using environment variable ${envKey} as fallback`);
        return process.env[envKey];
      }
    }
    
    // Если это JWT секрет, пробуем использовать JWT_SECRET из переменных окружения
    if (path.includes('jwt') && key === 'secret' && process.env.JWT_SECRET) {
      console.log('Using JWT_SECRET environment variable as fallback');
      return process.env.JWT_SECRET;
    }
    
    throw new Error(`Failed to read secret: ${error.message}`);
  }
};

/**
 * Write a secret to Vault
 * @param {string} path - Path to store the secret
 * @param {Object} data - Data to store
 * @returns {Promise<Object>} - Result of the write operation
 */
const writeSecret = async (path, data) => {
  try {
    // Ensure Vault client is initialized
    const client = await initVault();
    
    // Write the secret
    const result = await client.write(path, { data });
    console.log(`Secret written to ${path}`);
    
    return result;
  } catch (error) {
    console.error(`Failed to write secret to ${path}: ${error.message}`);
    // Для записи не используем fallback, просто логируем ошибку
    throw new Error(`Failed to write secret: ${error.message}`);
  }
};

/**
 * Delete a secret from Vault
 * @param {string} path - Path to the secret
 * @returns {Promise<Object>} - Result of the delete operation
 */
const deleteSecret = async (path) => {
  try {
    // Ensure Vault client is initialized
    const client = await initVault();
    
    // Delete the secret
    const result = await client.delete(path);
    console.log(`Secret deleted from ${path}`);
    
    return result;
  } catch (error) {
    console.error(`Failed to delete secret from ${path}: ${error.message}`);
    // Для удаления не используем fallback, просто логируем ошибку
    throw new Error(`Failed to delete secret: ${error.message}`);
  }
};

/**
 * List secrets at a particular path
 * @param {string} path - Path to list secrets from
 * @returns {Promise<Array>} - List of secrets
 */
const listSecrets = async (path) => {
  try {
    // Ensure Vault client is initialized
    const client = await initVault();
    
    // List secrets at path
    const { data } = await client.list(path);
    
    return data?.keys || [];
  } catch (error) {
    console.error(`Failed to list secrets at ${path}: ${error.message}`);
    // Для списка не используем fallback, просто возвращаем пустой массив
    return [];
  }
};

/**
 * Get Vault health status
 * @returns {Promise<Object>} - Vault health status
 */
const getHealthStatus = async () => {
  try {
    // Ensure Vault client is initialized
    const client = await initVault();
    
    // Get status
    return await client.health();
  } catch (error) {
    console.error(`Failed to get Vault health status: ${error.message}`);
    // Возвращаем базовый статус, если Vault недоступен
    return {
      initialized: false,
      sealed: true,
      standby: true,
      performance_standby: false,
      replication_performance_mode: "disabled",
      replication_dr_mode: "disabled",
      server_time_utc: Math.floor(Date.now() / 1000),
      version: "unknown",
      cluster_name: "unknown",
      cluster_id: "unknown"
    };
  }
};

module.exports = {
  // Original function exports
  initVault,
  readSecret,
  writeSecret,
  deleteSecret,
  listSecrets,
  getHealthStatus,
  getClient: () => vaultClient,
  
  // Aliases for backward compatibility
  init: initVault,       // Alias for initVault
  read: readSecret,      // Alias for readSecret
  write: writeSecret,    // Alias for writeSecret
  delete: deleteSecret,  // Alias for deleteSecret
  list: listSecrets,     // Alias for listSecrets
  getHealth: getHealthStatus, // Alias for getHealthStatus
  
  // Additional convenience methods that match how they might be used
  client: () => vaultClient
};
