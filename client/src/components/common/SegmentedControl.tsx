export interface SegmentedOption {
  label: string;
  value: string;
}

export interface SegmentedControlProps {
  value: string;
  options: SegmentedOption[];
  onChange: (value: string) => void;
}

export function SegmentedControl({
  value,
  options,
  onChange
}: SegmentedControlProps) {
  return (
    <div className="segmented" role="group" aria-label="Timespan">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
