interface Props {
  name: string;
  legend: string;
  variant: 'ownership' | 'size';
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}

export default function EquipmentChoice({
  name,
  legend,
  variant,
  value,
  options,
  onChange,
  required,
  disabled = false,
}: Props) {
  const missing = required === true && !value;
  return (
    <fieldset
      className={`equipment-choice equipment-choice--${variant}${missing ? ' is-missing' : ''}`}
      disabled={disabled}
    >
      <legend className="visually-hidden">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`equipment-choice__option equipment-choice__option--${option.value.toLowerCase()}${value === option.value ? ' is-selected' : ''}`}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            required={required === true}
            onChange={() => onChange(option.value)}
            onClick={() => {
              if (
                variant === 'size' &&
                required !== true &&
                value === option.value
              )
                onChange('');
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
