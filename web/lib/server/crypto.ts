import { keccak256, stringToHex } from 'viem';
import type { PrivateEvaluationReport } from '@/lib/evidence';

export interface StoredEnvelope {
  schemaVersion: 'evalvault-report-v1';
  salt: string;
  report: PrivateEvaluationReport;
}

function randomHex(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function serializeEnvelope(report: PrivateEvaluationReport): {
  envelope: StoredEnvelope;
  serialized: string;
  commitment: `0x${string}`;
} {
  const envelope: StoredEnvelope = {
    schemaVersion: 'evalvault-report-v1',
    salt: randomHex(),
    report,
  };
  const serialized = JSON.stringify(envelope);
  return { envelope, serialized, commitment: keccak256(stringToHex(serialized)) };
}

export function commitmentOf(serialized: string): `0x${string}` {
  return keccak256(stringToHex(serialized));
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken(): string {
  return randomHex(24);
}
