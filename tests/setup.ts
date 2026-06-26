// Provide the environment variables required by src/config/env.ts so the app
// and worker modules can be imported under test without a real .env file.
const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/predictify_test",
  JWT_SECRET: "test-secret-test-secret-test-secret-0123456789",
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  HORIZON_URL: "https://horizon-testnet.stellar.org",
  PREDICTIFY_CONTRACT_ID: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
