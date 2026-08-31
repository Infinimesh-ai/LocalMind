import ava from 'ava';

import {
  isStaffEmail,
  parseStaffEmailDomains,
} from '../../core/features/service';

ava('staff access is disabled when no domains are configured', t => {
  t.false(isStaffEmail('staff@infinimesh.example', []));
});

ava('staff domains are normalized and matched exactly', t => {
  const domains = parseStaffEmailDomains(
    ' @Infinimesh.example, localmind.example '
  );

  t.deepEqual(domains, ['infinimesh.example', 'localmind.example']);
  t.true(isStaffEmail('STAFF@INFINIMESH.EXAMPLE', domains));
  t.true(isStaffEmail('staff@localmind.example', domains));
  t.false(isStaffEmail('staff@evil-infinimesh.example', domains));
});
