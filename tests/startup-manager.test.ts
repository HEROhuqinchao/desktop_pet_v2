import { describe, expect, it } from 'vitest';
import { linuxAutostartEntry } from '../src/core/startup';

describe('Linux autostart entry', () => {
  it('quotes and escapes the packaged executable path', () => {
    const entry = linuxAutostartEntry(
      '/opt/Desktop Pet/bin/desktop-pet',
    );

    expect(entry).toContain(
      'Exec="/opt/Desktop Pet/bin/desktop-pet"',
    );
    expect(entry).toContain('X-GNOME-Autostart-enabled=true');
    expect(entry.endsWith('\n')).toBe(true);
  });

  it('escapes special characters inside the quoted Exec value', () => {
    const entry = linuxAutostartEntry('/tmp/a"$`b');

    expect(entry).toContain('Exec="/tmp/a\\"\\$\\`b"');
  });
});
