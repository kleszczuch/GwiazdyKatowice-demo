import type {
  Participant,
  ParticipantSection,
  ProfileParticipant,
  Section,
} from '../types/club';

export function participantExportRows(
  participants: Participant[],
  sections: Section[],
  assignments: ParticipantSection[],
  language: 'pl' | 'en',
): string[][] {
  const en = language === 'en';
  const levels = {
    beginner: en ? 'Beginner' : 'Początkujący',
    advanced: en ? 'Advanced' : 'Zaawansowany',
    coach: en ? 'Coach' : 'Trener',
  };
  const statuses = {
    pending: en ? 'Pending' : 'Oczekujący',
    active: en ? 'Active' : 'Aktywny',
    suspended: en ? 'Suspended' : 'Zawieszony',
    left: en ? 'Left' : 'Odszedł',
  };
  return [
    en
      ? ['Participant', 'Category', 'Level', 'Groups', 'Status']
      : ['Zawodnik', 'Kategoria', 'Poziom', 'Grupy', 'Status'],
    ...participants.map((person) => {
      // Status istnieje tylko w pełnym profilu; lista bez niego daje pustą kolumnę.
      const status = (person as Partial<ProfileParticipant>).status;
      return [
        person.name,
        person.category === 'child'
          ? en
            ? 'Child with a guardian'
            : 'Dziecko z opiekunem'
          : en
            ? 'Adult'
            : 'Dorosły',
        levels[person.level],
        sections
          .filter((section) =>
            assignments.some(
              (item) =>
                item.participant_id === person.id &&
                item.section_id === section.id,
            ),
          )
          .map((section) => section.name)
          .join(', '),
        status ? statuses[status] : '',
      ];
    }),
  ];
}
