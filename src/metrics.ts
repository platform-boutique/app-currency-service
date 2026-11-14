import type { Meter } from '@opentelemetry/api';

/** What the build_info gauge reports (CODE-06): all three come from the environment, see telemetryConfig.ts. */
export interface BuildInfo {
  serviceName: string;
  serviceVersion: string;
  serviceCommit: string;
}

/** build_info{service,version,commit} = 1, so a dashboard can show which build runs where. */
export function registerBuildInfo(meter: Meter, info: BuildInfo): void {
  const attributes = {
    service: info.serviceName,
    version: info.serviceVersion,
    commit: info.serviceCommit,
  };
  meter
    .createObservableGauge('build_info', {
      description: 'Build information of the running service, always 1',
    })
    .addCallback((obs) => obs.observe(1, attributes));
}
