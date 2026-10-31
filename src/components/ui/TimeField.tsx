import { useEffect, useState } from 'react';
import TextField from './TextField';

/** "7" → "07:00", "730" → "07:30", "7:5" → "07:05"; null when it is not a time of day. */
export function normalizeTime(text: string): string | null {
  const trimmed = text.trim();
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed) ?? /^(\d{1,2})(\d{2})?$/.exec(trimmed);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * A time of day (HH:MM) typed in an MD3 text field, not the browser's time picker. It takes
 * shortcuts ("7", "730") and writes the time out in full when the field loses focus.
 */
export default function TimeField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <TextField
      label={label}
      value={text}
      inputMode="numeric"
      placeholder="07:00"
      autoComplete="off"
      maxLength={5}
      error={error ?? null}
      onChange={(e) => {
        setText(e.target.value);
        const time = normalizeTime(e.target.value);
        if (time && e.target.value.length >= 4) onChange(time);
      }}
      onBlur={() => {
        const time = normalizeTime(text);
        if (time) {
          setText(time);
          if (time !== value) onChange(time);
        } else {
          setText(value);
        }
      }}
    />
  );
}
