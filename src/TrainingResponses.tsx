import './training-responses.css';
import SwordsLoader from './SwordsLoader';

export interface TrainingResponsePerson {
  name: string;
  role: 'coach' | 'participant';
  response: 'yes' | 'no' | null;
  avatarUrl?: string | null;
  personKey?: string;
}

interface Props {
  language: 'pl' | 'en';
  people: TrainingResponsePerson[];
  loading: boolean;
  error: boolean;
  onRetry?: () => void;
}

export default function TrainingResponses({
  language,
  people,
  loading,
  error,
  onRetry,
}: Props) {
  const en = language === 'en';
  const groups = [
    { response: 'yes', label: en ? 'Attending' : 'Będę', tone: 'yes' },
    { response: 'no', label: en ? 'Not attending' : 'Nie będę', tone: 'no' },
    {
      response: null,
      label: en ? 'No response' : 'Bez odpowiedzi',
      tone: 'pending',
    },
  ] as const;
  const roles = [
    { role: 'coach', label: en ? 'Coaches' : 'Trenerzy' },
    { role: 'participant', label: en ? 'Athletes' : 'Zawodnicy' },
  ] as const;
  return (
    <section
      className="training-responses"
      aria-busy={loading}
      aria-label={en ? 'Training responses' : 'Odpowiedzi na trening'}
    >
      <h3>{en ? 'Training responses' : 'Odpowiedzi na trening'}</h3>
      {loading ? (
        <SwordsLoader
          language={language}
          label={en ? 'Loading responses…' : 'Wczytuję odpowiedzi…'}
        />
      ) : error ? (
        <div className="notice" role="alert">
          <p>
            {en
              ? 'Could not load training responses.'
              : 'Nie udało się wczytać odpowiedzi na trening.'}
          </p>
          {onRetry && (
            <button
              type="button"
              className="button secondary small"
              onClick={onRetry}
            >
              {en ? 'Retry' : 'Ponów'}
            </button>
          )}
        </div>
      ) : (
        <div className="training-responses__groups">
          {groups.map((group) => {
            const members = people.filter(
              (person) => person.response === group.response,
            );
            return (
              <section
                key={group.tone}
                className={`training-responses__group training-responses__group--${group.tone}`}
                aria-label={group.label}
              >
                <h4>
                  {group.label} <span>({members.length})</span>
                </h4>
                {roles.map(({ role, label }) => {
                  const matching = members.filter(
                    (person) => person.role === role,
                  );
                  return (
                    <div key={role} className="training-responses__role">
                      <h5>{label}</h5>
                      {matching.length ? (
                        <ul>
                          {matching.map((person, index) => (
                            <li key={person.personKey ?? index}>
                              <span
                                className="training-responses__avatar"
                                aria-hidden="true"
                              >
                                {person.name
                                  .trim()
                                  .split(/\s+/u)
                                  .slice(0, 2)
                                  .map((part) => [...part][0] ?? '')
                                  .join('')
                                  .toLocaleUpperCase() || '?'}
                                {person.avatarUrl && (
                                  <img
                                    src={person.avatarUrl}
                                    alt=""
                                    onError={(event) => {
                                      event.currentTarget.hidden = true;
                                    }}
                                  />
                                )}
                              </span>
                              <span className="training-responses__name">
                                {person.name}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">
                          {en ? 'No people' : 'Brak osób'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
