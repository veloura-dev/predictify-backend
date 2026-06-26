process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/predictify";
process.env.JWT_SECRET ??= "test-jwt-secret-minimum-32-characters";
process.env.SOROBAN_RPC_URL ??= "https://soroban-testnet.stellar.org";
process.env.HORIZON_URL ??= "https://horizon-testnet.stellar.org";
process.env.PREDICTIFY_CONTRACT_ID ??= "CABCDEF123456789012345678901234567890";
