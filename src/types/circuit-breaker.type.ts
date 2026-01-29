export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
	failureThreshold?: number;
	successThreshold?: number;
	openDurationMs?: number;
	volumeThreshold?: number;
	errorPercentageThreshold?: number;
}
