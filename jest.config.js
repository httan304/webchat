module.exports = {
	moduleFileExtensions: ['js', 'json', 'ts'],
	
	rootDir: '.',
	
	testRegex: '.*\\.spec\\.ts$',
	
	transform: {
		'^.+\\.(t|j)s$': 'ts-jest',
	},
	
	collectCoverageFrom: [
		'src/**/*.(t|j)s',
		'!src/**/*.spec.ts',
		'!src/**/node_modules/**',
		'!src/**/dist/**',
		'!src/**/*.interface.ts',
		'!src/**/*.dto.ts',
		'!src/main.ts',
		'!src/migrations/**',
	],
	
	coverageDirectory: './coverage',
	
	testEnvironment: 'node',
	
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
	},
	clearMocks: true,
	resetMocks: false,
	restoreMocks: false,
};
