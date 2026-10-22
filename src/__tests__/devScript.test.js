const { watchArgs, ENTRY } = require('../../scripts/dev');

describe('npm run dev : surveillance du code', () => {
  test.each(['win32', 'darwin'])('%s : seul src/ est surveillé (jamais node_modules)', (platform) => {
    expect(watchArgs(platform)).toEqual(['--watch-path=./src']);
  });

  test('autres systèmes : --watch (--watch-path y est indisponible)', () => {
    expect(watchArgs('linux')).toEqual(['--watch']);
  });

  test('point d’entrée du serveur', () => {
    expect(ENTRY).toBe('src/index.js');
  });
});
