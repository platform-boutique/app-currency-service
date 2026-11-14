import type * as grpc from '@grpc/grpc-js';
import type { PackageDefinition } from '@grpc/proto-loader';
import { ReflectionService } from '@grpc/reflection';

/**
 * gRPC server reflection (CODE-02), so grpcurl and the like work without the .proto files.
 * Takes every package definition the server serves and registers the v1 and v1alpha services.
 */
export function addReflection(
  server: Pick<grpc.Server, 'addService'>,
  ...definitions: PackageDefinition[]
): void {
  new ReflectionService(Object.assign({}, ...definitions)).addToServer(server);
}
