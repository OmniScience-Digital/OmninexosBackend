// src/helper/ticket/ticket.helpers.test.ts  (run with: npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueEscalations, type EscalationInput } from './escalation';
import {
  buildDescription,
  buildTaskName,
  escapeTelegram,
  followUpComment,
  formatTicketNumber,
  gleedComment,
  isBotText,
  telegramEscalationMessage,
  telegramUpdateMessage,
} from './ticket.format';
import { BOT_SIGNATURE, getBusinessCalendar } from './ticket.config';

const cal = getBusinessCalendar({} as NodeJS.ProcessEnv);
const sast = (iso: string) => new Date(`${iso}+02:00`);

// ---------------------------------------------------------------- formatting
test('task numbers are padded and the pad is configurable', () => {
  assert.equal(formatTicketNumber(1), 'T-0001');
  assert.equal(formatTicketNumber(42), 'T-0042');
  assert.equal(formatTicketNumber(12345), 'T-12345');
  assert.equal(formatTicketNumber(1, 5), 'T-00001');
});

test('task name is "T-0001, Title" with tidy spacing', () => {
  assert.equal(buildTaskName('T-0001', '  Fix   the pump '), 'T-0001, Fix the pump');
});

test('description lists assignees, due date and outcome, and flags fallbacks', () => {
  const text = buildDescription({
    assignees: [
      { name: 'Marco', clickupUserId: 1, fallback: false },
      { name: 'Byron', clickupUserId: 9, fallback: true },
    ],
    dueAt: sast('2026-11-10T13:00:00'),
    requiredOutcome: ' Pump running ',
  });
  assert.equal(
    text,
    'Assignees: Marco, Byron (not on ClickUp)\nDue Date: Tue 10 Nov 2026, 13:00 SAST\nRequired Outcome: Pump running'
  );
});

test('Telegram text escapes legacy Markdown characters', () => {
  assert.equal(escapeTelegram('pump_2 *urgent* [a] `x`'), 'pump\\_2 \\*urgent\\* \\[a] \\`x\\`');
  assert.equal(
    telegramUpdateMessage('T-0001, Fix pump_2', 'Sean Fray', 'Started *now*'),
    'T-0001, Fix pump\\_2\nSean Fray sent this message: Started \\*now\\*'
  );
});

test('very long updates are clipped under the Telegram limit', () => {
  assert.ok(telegramUpdateMessage('T-0001, x', 'A', 'y'.repeat(10_000)).length < 4096);
});

test('escalation notice names the stage and never mentions Gleed or tagging', () => {
  const due = sast('2026-11-10T13:00:00');
  assert.match(telegramEscalationMessage('T-0001, x', 'followUp', due), /50%/);
  const g = telegramEscalationMessage('T-0001, x', 'gleed', due);
  assert.match(g, /70%/);
  assert.doesNotMatch(g, /Gleed|tagged/); // the group is never told who was tagged
});

test('ClickUp comments tag the right people and carry the bot signature', () => {
  const due = sast('2026-11-10T13:00:00');
  const f = followUpComment('T-0001', [11, 22], due);
  assert.deepEqual(
    f.filter((b) => 'type' in b),
    [
      { type: 'tag', user: { id: 11 } },
      { type: 'tag', user: { id: 22 } },
    ]
  );
  const g = gleedComment('T-0001', null, due); // Gleed unresolved: still posts, no tag
  assert.equal(g.filter((b) => 'type' in b).length, 0);
  for (const blocks of [f, g]) {
    const all = blocks.map((b) => ('text' in b ? b.text : '')).join('');
    assert.ok(isBotText(all));
    assert.ok(all.includes(BOT_SIGNATURE));
  }
  assert.equal(isBotText('I have started'), false);
});

// ---------------------------------------------------------------- escalation
const base = (over: Partial<EscalationInput>): EscalationInput => ({
  urgencyMinutes: 240, // 4H
  submittedAt: sast('2026-11-09T08:00:00'),
  now: sast('2026-11-09T08:00:00'),
  hasUpdate: false,
  followUpDone: false,
  gleedDone: false,
  ...over,
});

test('4H task: nothing before 50%, follow-up at 50%, Gleed at 70%', () => {
  assert.deepEqual(dueEscalations(base({ now: sast('2026-11-09T09:55:00') }), cal), []); // 115 min
  assert.deepEqual(dueEscalations(base({ now: sast('2026-11-09T10:00:00') }), cal), ['followUp']); // 120 = 50%
  assert.deepEqual(
    dueEscalations(base({ now: sast('2026-11-09T10:55:00'), followUpDone: true }), cal),
    ['gleed']
  ); // 175 >= 168
});

test('70% is 168 minutes on a 4H task', () => {
  assert.deepEqual(
    dueEscalations(base({ now: sast('2026-11-09T10:47:00'), followUpDone: true }), cal),
    []
  ); // 167
  assert.deepEqual(
    dueEscalations(base({ now: sast('2026-11-09T10:48:00'), followUpDone: true }), cal),
    ['gleed']
  ); // 168
});

test('a person replying stops all escalation', () => {
  assert.deepEqual(
    dueEscalations(base({ now: sast('2026-11-09T14:00:00'), hasUpdate: true }), cal),
    []
  );
});

test('steps already done are not repeated', () => {
  const now = sast('2026-11-09T14:00:00');
  assert.deepEqual(dueEscalations(base({ now, followUpDone: true, gleedDone: true }), cal), []);
});

test('after downtime both steps come out in order', () => {
  assert.deepEqual(dueEscalations(base({ now: sast('2026-11-09T14:00:00') }), cal), [
    'followUp',
    'gleed',
  ]);
});

test('ASAP escalates on the first check inside business hours', () => {
  const t = base({
    urgencyMinutes: 0,
    submittedAt: sast('2026-11-09T10:00:00'),
    now: sast('2026-11-09T10:05:00'),
  });
  assert.deepEqual(dueEscalations(t, cal), ['followUp', 'gleed']);
});

test('nothing is posted outside business hours, it waits for 06:00', () => {
  const t = base({
    urgencyMinutes: 0,
    submittedAt: sast('2026-11-09T21:00:00'),
    now: sast('2026-11-09T21:05:00'),
  });
  assert.deepEqual(dueEscalations(t, cal), []);
  assert.deepEqual(dueEscalations({ ...t, now: sast('2026-11-10T06:05:00') }, cal), [
    'followUp',
    'gleed',
  ]);
});

test('overnight time does not count: 16H task submitted 16:00', () => {
  const t = base({ urgencyMinutes: 960, submittedAt: sast('2026-11-09T16:00:00') });
  // 60 min used by 17:00, 60 more by 07:00 next day = 120 of 960: nowhere near 50%
  assert.deepEqual(dueEscalations({ ...t, now: sast('2026-11-10T07:00:00') }, cal), []);
});
