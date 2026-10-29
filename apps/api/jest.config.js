/**
 * Unit-test config for the API. The spec files are unit tests: PrismaService
 * and NotificationsService are injected as mocks, so no database connection is
 * opened and the suite is safe to run against any environment.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.ts', '!**/*.d.ts', '!**/*.module.ts'],
};
