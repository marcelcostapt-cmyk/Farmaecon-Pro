module.exports = {
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'CommonJS', target: 'ES2022', esModuleInterop: true, types: ['jest', 'node'] } }] },
};
