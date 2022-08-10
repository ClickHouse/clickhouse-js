import { randomUUID } from 'crypto';

export function guid() {
  return randomUUID().replace(/-/g, '');
}
