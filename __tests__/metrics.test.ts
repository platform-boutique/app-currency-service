import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { registerBuildInfo } from '../src/metrics';

// A reader that is only collected by hand: the interval is far beyond the test, so no timer ever fires.
function setup() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 3_600_000,
  });
  const provider = new MeterProvider({ readers: [reader] });
  return {
    meter: provider.getMeter('test'),
    async collect() {
      const { resourceMetrics } = await reader.collect();
      return resourceMetrics.scopeMetrics.flatMap((s) => s.metrics);
    },
    shutdown: () => provider.shutdown(),
  };
}

describe('build_info', () => {
  it('is 1 with service, version and commit labels', async () => {
    const t = setup();
    registerBuildInfo(t.meter, {
      serviceName: 'currency-service',
      serviceVersion: '1.2.3',
      serviceCommit: 'abc1234',
    });
    const metric = (await t.collect()).find((m) => m.descriptor.name === 'build_info');
    expect(metric).toBeDefined();
    expect(metric!.dataPoints).toHaveLength(1);
    expect(metric!.dataPoints[0].value).toBe(1);
    expect(metric!.dataPoints[0].attributes).toEqual({
      service: 'currency-service',
      version: '1.2.3',
      commit: 'abc1234',
    });
    await t.shutdown();
  });
});
