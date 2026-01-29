module.exports = {
	moduleFileExtensions: ['js', 'json', 'ts'],
	rootDir: 'src',
	testRegex: '.*\\.spec\\.ts$',
	transform: {
		'^.+\\.(t|j)s$': 'ts-jest',
	},
	collectCoverageFrom: [
		'**/*.(t|j)s',
		'!**/*.spec.ts',
		'!**/node_modules/**',
		'!**/dist/**',
		'!**/*.interface.ts',
		'!**/*.dto.ts',
		'!**/main.ts',
		'!**/migrations/**',
	],
	coverageDirectory: '../coverage',
	testEnvironment: 'node',
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/$1',
	},
	globals: {
		'ts-jest': {
			isolatedModules: true,
		},
	},
};
