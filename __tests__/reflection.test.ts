import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { addReflection } from '../src/reflection';

const OPTS = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true };
const currencyDef = protoLoader.loadSync(path.join(__dirname, '../proto/currency.proto'), OPTS);
const healthDef = protoLoader.loadSync(path.join(__dirname, '../proto/health.proto'), OPTS);
// The reflection client uses the proto shipped in the package.
const reflectionProto =
  require.resolve('@grpc/reflection/build/proto/grpc/reflection/v1/reflection.proto');

let server: grpc.Server;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;

beforeAll(async () => {
  server = new grpc.Server();
  addReflection(server, currencyDef, healthDef);
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) =>
      err ? reject(err) : resolve(p),
    ),
  );
  const def = protoLoader.loadSync(reflectionProto, OPTS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pkg = (grpc.loadPackageDefinition(def) as any).grpc.reflection.v1;
  client = new pkg.ServerReflection(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
});

afterAll(() => {
  client?.close();
  server?.forceShutdown();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ask(request: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const stream = client.ServerReflectionInfo();
    stream.on('data', (res: unknown) => {
      resolve(res);
      stream.end();
    });
    stream.on('error', reject);
    stream.write(request);
  });
}

describe('gRPC reflection (CODE-02)', () => {
  it('lists the currency and the health service', async () => {
    const res = await ask({ list_services: '*' });
    const names = res.list_services_response.service.map((s: { name: string }) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['hipstershop.CurrencyService', 'grpc.health.v1.Health']),
    );
  });

  it('serves the file descriptor of a service symbol', async () => {
    const res = await ask({ file_containing_symbol: 'hipstershop.CurrencyService' });
    expect(res.file_descriptor_response.file_descriptor_proto.length).toBeGreaterThan(0);
  });
});
