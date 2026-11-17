import { useState } from 'react';
import {
  TRAINING_ICONS,
  TRAINING_ICON_IMAGES,
  trainingIcon,
  trainingIconLabel,
} from './lib/training-icons.ts';
import { assetUrl } from './lib/asset-url';
import './training-icons.css';

export function TrainingBadge({
  icon,
  language,
}: {
  icon?: unknown;
  language: 'pl' | 'en';
}) {
  const selected = trainingIcon(icon);
  const label = trainingIconLabel(icon, language);
  return (
    <span
      className={`training-badge${selected ? '' : ' training-badge--default'}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {selected ? (
        <img
          src={assetUrl(TRAINING_ICON_IMAGES[selected])}
          alt=""
          width={40}
          height={40}
        />
      ) : (
        '–'
      )}
    </span>
  );
}
export default function TrainingIconPicker({
  language,
  value,
  onChange,
  disabled = false,
}: {
  language: 'pl' | 'en';
  value?: unknown;
  onChange?: (value: string | null) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(() => trainingIcon(value));
  return (
    <label className="training-icon-picker">
      {language === 'en' ? 'Training icon' : 'Ikonka treningu'}
      <span className="training-icon-picker__control">
        <TrainingBadge icon={onChange ? value : draft} language={language} />
        <select
          name="icon"
          value={onChange ? (trainingIcon(value) ?? '') : undefined}
          defaultValue={onChange ? undefined : (trainingIcon(value) ?? '')}
          disabled={disabled}
          onChange={(event) => {
            setDraft(trainingIcon(event.target.value));
            onChange?.(trainingIcon(event.target.value));
          }}
        >
          <option value="">
            {language === 'en'
              ? 'Default (no custom icon)'
              : 'Domyślna (bez własnej ikonki)'}
          </option>
          {TRAINING_ICONS.map((icon) => (
            <option key={icon} value={icon}>
              {trainingIconLabel(icon, language)}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
