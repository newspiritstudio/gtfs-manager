import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from './fetch';

describe('isPrivateAddress', () => {
  it('blocks loopback, private, link-local and CGNAT IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '198.18.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('blocks private IPv6 and IPv4-mapped addresses', () => {
    for (const ip of [
      '::1',
      '::',
      'fc00::1',
      'fd12::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2a00:1450:4003::1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});
