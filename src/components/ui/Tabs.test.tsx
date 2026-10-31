import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Tabs, { tabPanelProps } from './Tabs';

const tabs = [
  { value: 'a', label: 'Esquema' },
  { value: 'b', label: 'Mapa' },
];

describe('Tabs', () => {
  it('apunta la pestanya triada al tauler i el tauler a la pestanya', () => {
    render(<Tabs idBase="x" label="Views" tabs={tabs} value="b" onChange={() => {}} />);
    const active = screen.getByRole('tab', { name: 'Mapa' });
    expect(active.id).toBe('x-tab-b');
    expect(active.getAttribute('aria-controls')).toBe('x-panel');
    expect(screen.getByRole('tab', { name: 'Esquema' }).getAttribute('aria-controls')).toBeNull();
    expect(tabPanelProps('x', 'b')).toEqual({
      role: 'tabpanel',
      id: 'x-panel',
      'aria-labelledby': 'x-tab-b',
    });
  });

  it('arrow keys move focus and select the tab', () => {
    const onChange = vi.fn();
    render(<Tabs label="Views" tabs={tabs} value="a" onChange={onChange} />);
    const first = screen.getByRole('tab', { name: 'Esquema' });
    first.focus();
    fireEvent.keyDown(first.parentElement!, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
