import path from 'path';

try {
  process.loadEnvFile?.(path.resolve(process.cwd(), '.env'));
} catch {
  // .env may not exist or may already be loaded via environment
}
