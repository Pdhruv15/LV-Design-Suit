/** The version as the app shows it: major, then the minor as three digits ("2.11.0" → "2.011"). package.json keeps
 * plain semver, which allows no leading zeros. */
export function displayVersion(semver: string): string {
  const [major, minor = '0'] = semver.split('.');
  return `${major}.${minor.padStart(3, '0')}`;
}
