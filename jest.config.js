// Tests de integración contra la base de TEST (easysales_test). Ver CLAUDE.md.
// - globalSetup: recrea la base (drop + migrations + seed fijo) UNA vez por corrida.
// - maxWorkers 1: todos los archivos comparten la misma base y la misma caja abierta.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/test/setup/env.js'],
  setupFilesAfterEnv: ['<rootDir>/test/setup/afterEnv.ts'],
  globalSetup: '<rootDir>/test/setup/globalSetup.js',
  maxWorkers: 1,
  testTimeout: 30000,
  silent: true,           // los errores esperados se loguean; ver con: npx jest --silent=false
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};
