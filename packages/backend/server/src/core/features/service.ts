import { Injectable, Logger } from '@nestjs/common';

import { Models } from '../../models';

export function parseStaffEmailDomains(value: string) {
  return value
    .split(',')
    .map(domain => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export function isStaffEmail(email: string, domains: readonly string[]) {
  const normalizedEmail = email.trim().toLowerCase();
  return domains.some(domain => normalizedEmail.endsWith(`@${domain}`));
}

const STAFF_EMAIL_DOMAINS = parseStaffEmailDomains(
  process.env.LOCALMIND_STAFF_EMAIL_DOMAINS ?? ''
);

@Injectable()
export class FeatureService {
  protected logger = new Logger(FeatureService.name);

  constructor(private readonly models: Models) {}

  // ======== Admin ========
  isStaff(email: string) {
    return isStaffEmail(email, STAFF_EMAIL_DOMAINS);
  }

  isAdmin(userId: string) {
    return this.models.userFeature.has(userId, 'administrator');
  }

  addAdmin(userId: string) {
    return this.models.userFeature.add(userId, 'administrator', 'Admin user');
  }
}
