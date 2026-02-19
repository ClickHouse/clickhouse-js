import {
  BatchSpanProcessor,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
// import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { ZoneContextManager } from '@opentelemetry/context-zone'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import {
  ATTR_SERVICE_VERSION,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions'

console.log('Initializing OTEL for Vitest in the browser...')

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: import.meta.env.OTEL_SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: import.meta.env.GITHUB_SHA?.substring(0, 7),
  'ci.run.id': import.meta.env.GITHUB_RUN_ID,
  'ci.job.name': import.meta.env.GITHUB_JOB_NAME,
  'ci.workflow': import.meta.env.GITHUB_WORKFLOW,
  'test.platform': 'web',
})

const provider = new WebTracerProvider({
  resource,
  spanProcessors: [
    new BatchSpanProcessor(
      // https://opentelemetry.io/docs/languages/js/exporters/
      new OTLPTraceExporter({
        url: `${import.meta.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
        // optional - collection of custom headers to be sent with each request, empty by default
        headers: import.meta.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').reduce(
          (acc, header) => {
            const [key, ...value] = header.split('=')
            acc[key.trim()] = value.join('=').trim()
            return acc
          },
          {},
        ),
      }),
    ),
  ],
})

provider.register({
  // Changing default contextManager to use ZoneContextManager - supports asynchronous operations - optional
  contextManager: new ZoneContextManager(),
})

registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation(),
    // new DocumentLoadInstrumentation()
  ],
})

export default provider
