## Automated Testing

### Prerequisites

```bash
node >= 18
npm >= 9
```

### Clean Jest Cache (IMPORTANT)

When tests fail randomly or all tests fail together:

```bash
npx jest --clearCache
rm -rf node_modules/.cache
```

### Run Unit Tests

```bash
npm run test
# or
yarn test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run with Coverage

```bash
npm run test:cov
```

### Jest Configuration Notes (NestJS)

- Do **NOT** use `jest.resetModules()`
- Avoid `resetMocks` and `restoreMocks` globally
- Prefer `clearMocks: true`

### Correct `test/setup.ts`

```ts
afterEach(() => {
  jest.clearAllMocks();
});
```

### Best Practices

- One service = one spec file
- Mock all external dependencies
- Do not rely on implicit NestJS DI

### Debugging Failed Tests

```bash
yarn test --runInBand
```

Use this when tests fail only when running the full suite.

## CI/CD Testing

Run the same commands inside pipeline containers.
