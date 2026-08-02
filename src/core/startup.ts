export function linuxAutostartEntry(executable: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=Desktop Pet',
    `Exec="${escapeDesktopEntryArgument(executable)}"`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'Comment=Independent desktop pet and reminder assistant',
    '',
  ].join('\n');
}

function escapeDesktopEntryArgument(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('`', '\\`')
    .replaceAll('$', '\\$');
}
