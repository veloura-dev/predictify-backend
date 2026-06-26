// Set required env vars for tests before any module is loaded.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://localhost:5432/predictify_test";
process.env.JWT_SECRET = "test-secret-minimum-32-bytes-long!!";
process.env.SOROBAN_RPC_URL = "http://localhost:8000";
process.env.HORIZON_URL = "http://localhost:8000";
process.env.PREDICTIFY_CONTRACT_ID = "CTEST000";
