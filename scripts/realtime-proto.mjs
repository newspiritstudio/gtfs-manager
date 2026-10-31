// Compiles the vendored gtfs-realtime.proto into the protobufjs JSON descriptor the server loads.
// Usage: npm run realtime:proto
import { readFileSync, writeFileSync } from 'node:fs';
import protobuf from 'protobufjs';

const dir = new URL('../src/server/realtime/', import.meta.url);
const proto = readFileSync(new URL('gtfs-realtime.proto', dir), 'utf8');
const { root } = protobuf.parse(proto, { keepCase: false });
writeFileSync(new URL('gtfs-realtime.json', dir), `${JSON.stringify(root.toJSON())}\n`);
console.log('Wrote src/server/realtime/gtfs-realtime.json');
